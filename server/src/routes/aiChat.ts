// MILESTONE-011 Checkpoint A — POST /api/ai/chat (REQ-F-070..077, DEC-091).
//
// The three-stage architecture from ai/AI_AGENT_SPEC.md, adopted unchanged:
//   Stage 0  server, no LLM — trigger detection + the FIXED referral notice;
//            clear-cut medical-only questions stop here (the provider is
//            never called — §3.3's clear-cut case).
//   Stage 1  provider.extractCriteria — criteria NAMES or a clarifying
//            question. The provider sees the message + history + language,
//            nothing else (privacy by shape — see lib/ai/provider.ts).
//   Stage 2  server, no LLM — name→id mapping (drop, never invent) + THE
//            SAME where-builder GET /api/products runs. Products come from
//            PostgreSQL only.
//   Stage 3  provider.explainProducts — prose beside the cards, guarded by
//            explanationGuard (count, length, no unknown-product mentions).
//
// 🔴 GUESTS AND SIGNED-IN ALIKE (REQ-F-070): no requireAuth. Rate-limited
// per DEC-091 O3 (lib/rateLimit.ts AI_RATE_LIMITS).
// 🔴 ZERO DATABASE WRITES (prohibition #8): this module performs reads only,
// and the integration suite proves it by row-count comparison across every
// table after a full conversation.
// §3.3 minimisation: redaction of known sensitive specifics lives at the
// PROVIDER boundary (lib/ai/groqProvider.ts calls
// triggers.redactSensitiveTerms on every user-authored string before it
// leaves the process — DEC-094 item 6). It is a keyword screen, not NER;
// its honest scope is documented beside the vocabulary in triggers.ts.
// The length cap below bounds payload size; it is not redaction.

import { Router, type RequestHandler } from 'express'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import {
  CatalogIntegrityError,
  mapProductToPublicCatalog,
  type PublicCatalogProduct,
} from '../lib/catalogMapper.js'
import { buildProductWhere } from '../lib/catalogFilterWhere.js'
import { buildOrderBy } from '../lib/catalogOrderBy.js'
import { CATALOG_RELATIONS_INCLUDE } from '../lib/catalogProductLookup.js'
import { createAiRateLimiters } from '../lib/rateLimit.js'
import { REFERRAL_NOTICE } from '../lib/ai/notices.js'
import { detectTriggers, isMedicalOnly } from '../lib/ai/triggers.js'
import { resolveCriteria, type HandoffParams } from '../lib/ai/criteriaMapping.js'
import { guardExplanations } from '../lib/ai/explanationGuard.js'
import type { AIProvider } from '../lib/ai/provider.js'

// Operational limits — the spec's Proposed numbers become this plan's
// defaults (§11.2): 5 products per response, 10 conversation turns, 15s
// provider timeout. MAX_MESSAGE_LENGTH bounds what a provider will ever be
// asked to read.
export const MAX_MESSAGE_LENGTH = 500
export const MAX_TURNS = 10
export const MAX_PRODUCTS = 5
export const PROVIDER_TIMEOUT_MS = 15_000

/**
 * The schema cap is deliberately GENEROUS (review finding): the real limit
 * is the turn cap in the handler, which owns the AI_TURN_LIMIT code. A
 * strict `.max(MAX_TURNS * 2)` here meant a client storing notice+question
 * as two agent entries crossed the SCHEMA cap first and got the nonsense
 * AI_INVALID_BODY ("max 500 characters") for a conversation that was simply
 * long. Zod now only rejects shapes that are malformed, never merely long.
 */
const MAX_HISTORY_ENTRIES = 100

const chatBodySchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  lang: z.enum(['he', 'en']),
  // The client holds the whole conversation — DEC-091 O1: the server stores
  // NOTHING. History arrives per request and dies with the response.
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'agent']),
        content: z.string().max(MAX_MESSAGE_LENGTH * 2),
      }),
    )
    .max(MAX_HISTORY_ENTRIES)
    .default([]),
})

export interface AgentChatResponse {
  products: PublicCatalogProduct[]
  explanations: string[]
  /** The FIXED referral notice in the request's language, or null. Never provider text. */
  notice: string | null
  /** Provider-authored clarifying prose (an LLM's output is data), or null. */
  clarifyingQuestion: string | null
  /**
   * Server-detected clarify condition as a CODE the client translates
   * (CLAUDE.md rule 4 — the server authors no display prose; review
   * finding). Today: 'NO_CRITERIA_MATCHED' when every provider label
   * dropped against the real tables.
   */
  clarifyCode: 'NO_CRITERIA_MATCHED' | null
  /** True when Stage 0 stopped a clear-cut medical question — no search ran. */
  medicalStop: boolean
  /** REQ-F-077 — the resolved criteria as /catalog URL params, or null when none resolved. */
  handoff: HandoffParams | null
  /** True when a search ran and matched nothing (the REQ-F-077 empty path). */
  emptyResult: boolean
}

/**
 * The all-empty baseline, overridden per branch (review finding: five
 * hand-written seven-field literals made a wrong copy-paste default — e.g.
 * emptyResult:true on the medical-stop branch — both easy and invisible).
 */
function emptyResponse(overrides: Partial<AgentChatResponse> = {}): AgentChatResponse {
  return {
    products: [],
    explanations: [],
    notice: null,
    clarifyingQuestion: null,
    clarifyCode: null,
    medicalStop: false,
    handoff: null,
    emptyResult: false,
    ...overrides,
  }
}

class ProviderTimeoutError extends Error {}

/**
 * Bounds a provider call. On timeout the shared AbortController is
 * signalled, so a real (network) provider stops burning money the moment
 * the caller stops waiting — the mock simply ignores the signal.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  abort?: AbortController,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          abort?.abort()
          reject(new ProviderTimeoutError())
        }, ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export interface AiChatRouterDeps {
  prisma: PrismaClient
  /** Tests inject slow/failing/malicious providers; production resolves from env. */
  provider: AIProvider
  timeoutMs?: number
  /** Tests may bypass the shared limiter instance to probe it separately. */
  rateLimiter?: RequestHandler
}

export function createAiChatRouter(deps: AiChatRouterDeps): Router {
  const { prisma, provider } = deps
  const timeoutMs = deps.timeoutMs ?? PROVIDER_TIMEOUT_MS
  const limiter = deps.rateLimiter ?? createAiRateLimiters().chat

  const router = Router()

  router.post('/chat', limiter, async (req, res) => {
    const parsed = chatBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'AI_INVALID_BODY',
          message:
            'The request body must carry a non-empty message (max 500 characters), a lang of "he" or "en", and an optional history array.',
        },
      })
      return
    }
    const { message, lang, history } = parsed.data

    // The turn cap counts USER turns — a conversation's length, not its
    // array encoding — with an entries backstop for degenerate transcripts.
    // One limit, one code, so the client can always say "start a new
    // conversation" (review finding: the schema cap used to fire first with
    // the wrong code).
    const userTurns = history.filter((turn) => turn.role === 'user').length
    if (userTurns >= MAX_TURNS || history.length >= MAX_TURNS * 2 + 1) {
      res.status(400).json({
        error: {
          code: 'AI_TURN_LIMIT',
          message: 'This conversation has reached its length limit. Please start a new one.',
        },
      })
      return
    }

    // ── Stage 0 — server-side, before any provider call ──────────────────
    if (isMedicalOnly(message)) {
      // Clear-cut medical question: fixed notice, no provider call, no
      // products. 🔴 The notice is attached even if no keyword family
      // matched — a dosage/diagnosis question IS the medical situation the
      // notice exists for. (Checked FIRST: computing the full trigger scan
      // just to discard it on this branch was review-flagged waste.)
      res.json(emptyResponse({ notice: REFERRAL_NOTICE[lang], medicalStop: true }))
      return
    }

    const triggers = detectTriggers(message)
    const notice = triggers.length > 0 ? REFERRAL_NOTICE[lang] : null

    // ── Stage 1 — the provider translates, or asks ───────────────────────
    let extraction
    try {
      const abort = new AbortController()
      extraction = await withTimeout(
        provider.extractCriteria(message, history, lang, abort.signal),
        timeoutMs,
        abort,
      )
    } catch (error) {
      respondProviderFailure(res, error)
      return
    }

    if (extraction.kind === 'clarify') {
      res.json(emptyResponse({ notice, clarifyingQuestion: extraction.question }))
      return
    }

    // ── Stage 2 — server-side mapping + the catalogue's own query ────────
    const { resolved, handoffParams, hasAnyCriterion } = await resolveCriteria(
      prisma,
      extraction.criteria,
    )

    if (!hasAnyCriterion) {
      // Everything the provider offered was dropped against the real
      // tables. That is a clarify situation, not an unfiltered catalogue
      // dump — an empty where-clause would "recommend" the whole shop. The
      // client renders the fixed i18n string for the code.
      res.json(emptyResponse({ notice, clarifyCode: 'NO_CRITERIA_MATCHED' }))
      return
    }

    const where = buildProductWhere(
      {
        // ISSUE-150 — the provider's product-name phrase rides the SAME
        // free-text search /catalog runs (already screened by qSchema in
        // criteriaMapping).
        q: resolved.q,
        brand: resolved.brandIds,
        ingredient: resolved.ingredientIds,
        healthGoal: resolved.healthGoalIds,
        dosageForm: resolved.dosageForms,
        minPrice: resolved.priceMin,
        maxPrice: resolved.priceMax,
        inStock: resolved.inStockOnly,
        kosher: resolved.kosher,
        glutenFree: resolved.glutenFree,
        vegan: resolved.vegan,
      },
      resolved.categoryNameHe,
    )

    const rows = await prisma.product.findMany({
      where,
      orderBy: buildOrderBy('newest'),
      take: MAX_PRODUCTS,
      include: CATALOG_RELATIONS_INCLUDE,
    })

    let products: PublicCatalogProduct[]
    try {
      products = rows.map(mapProductToPublicCatalog)
    } catch (error) {
      // Same fail-closed behaviour as GET /api/products (review finding:
      // this route answered the identical data defect with an HTML 500
      // where the catalogue answers with the coded envelope ops greps for).
      if (error instanceof CatalogIntegrityError) {
        console.error(`[catalog] data integrity failure: ${error.message}`)
        res.status(500).json({
          error: {
            code: 'CATALOG_DATA_INTEGRITY',
            message: 'The catalogue could not be served due to a data-integrity problem.',
          },
        })
        return
      }
      throw error
    }

    if (products.length === 0) {
      // ISSUE-150 ∩ TEST-072, review-hardened: a free-text q that reached
      // ZERO results is a phrase the catalogue search already rejected —
      // a handoff link carrying it promises a search known to find
      // nothing. So q is STRIPPED from the offer (decided on `resolved`,
      // never on a param count — the count proxy silently broke the
      // moment q rode with one more criterion). Whatever criteria remain
      // decide the branch: some → the honest empty-result handoff
      // ("בריאמיל עד 50" still offers the ₪50 filter); none → the coded
      // clarify the acceptance row pins ("שיעור כימיה" still clarifies).
      const offeredParams = { ...handoffParams }
      if (resolved.q !== undefined) delete offeredParams.q
      if (Object.keys(offeredParams).length === 0) {
        res.json(emptyResponse({ notice, clarifyCode: 'NO_CRITERIA_MATCHED' }))
        return
      }
      // REQ-F-077: say so explicitly (client renders the fixed empty-state
      // string), offer the handoff with the criteria preserved. The agent
      // NEVER invents a product to fill the gap.
      res.json(emptyResponse({ notice, handoff: offeredParams, emptyResult: true }))
      return
    }

    // ── Stage 3 — provider prose, guarded ────────────────────────────────
    // 🔴 ANY provider failure here degrades to cards-without-prose — the
    // products are real and already retrieved; losing the explanation is
    // never a reason to lose the answer (review finding: only the timeout
    // used to degrade; other provider errors threw the products away as a
    // 502 blamed on the provider).
    let explanations = products.map(() => '')
    let raw: string[] | null = null
    // Fired concurrently with the provider call; the no-op catch prevents
    // an unhandled rejection if the provider fails first and the names are
    // never awaited. A real failure still surfaces at the await below.
    const catalogueNamesPromise = prisma.product.findMany({
      where: { isActive: true },
      select: { nameHe: true, nameEn: true },
    })
    catalogueNamesPromise.catch(() => {})
    try {
      const abort = new AbortController()
      raw = await withTimeout(
        provider.explainProducts(products, message, lang, abort.signal),
        timeoutMs,
        abort,
      )
    } catch (error) {
      if (!(error instanceof ProviderTimeoutError)) {
        console.error('[ai] explanation phase failed — serving cards without prose', error)
      }
      raw = null
    }
    if (raw !== null) {
      const catalogueNames = await catalogueNamesPromise
      explanations = guardExplanations({ products, explanations: raw, catalogueNames })
    }

    res.json(
      emptyResponse({
        products,
        explanations,
        notice,
        handoff: handoffParams,
      }),
    )
  })

  return router
}

function respondProviderFailure(res: Parameters<RequestHandler>[1], error: unknown): void {
  if (error instanceof ProviderTimeoutError) {
    res.status(504).json({
      error: {
        code: 'AI_PROVIDER_TIMEOUT',
        message: 'The assistant took too long to answer. Please try again, or use the regular search.',
      },
    })
    return
  }
  console.error('[ai] provider failure', error)
  res.status(502).json({
    error: {
      code: 'AI_PROVIDER_FAILED',
      message: 'The assistant is unavailable right now. Please use the regular search.',
    },
  })
}
