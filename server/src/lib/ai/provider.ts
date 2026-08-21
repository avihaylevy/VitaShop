// MILESTONE-011 Checkpoint A — the AIProvider interface (ARCH-001, DEC-006).
//
// 🔴 THE VENDOR BOUNDARY (DEC-006): this module defines the seam; every
// vendor specific lives inside that provider's own file. Implementations:
// MockProvider (the default, always) and GroqProvider (DEC-094 — selected
// by AI_PROVIDER=groq WITH a user-placed key; an agent never obtains,
// generates, or configures a key, per DEC-014).
//
// 🔴 PRIVACY BY SHAPE (§3.3): the extraction call receives the message text,
// the client-held conversation history, and the language — no session id, no
// user row, no order history is even representable here. The explanation call
// receives the retrieved public DTOs and the message. Nothing else exists in
// the interface, so nothing else can leak.

import type { PublicCatalogProduct } from '../catalogMapper.js'
import type { AgentLang } from './notices.js'

export interface ChatTurn {
  role: 'user' | 'agent'
  content: string
}

/**
 * Stage 1 output — criteria as NAMES, not ids. The provider (an LLM one day,
 * the deterministic mock today) speaks in labels; the SERVER maps every label
 * to an id against the real tables (criteriaMapping.ts), and a label with no
 * match is DROPPED, never invented (AI_AGENT_SPEC — the schema note).
 */
export interface ExtractedCriteriaNames {
  /** Canonical category — nameHe, nameEn, or slug. */
  category?: string
  brands: string[]
  ingredients: string[]
  healthGoals: string[]
  /** Free words ("קפסולות", "drops") — mapped to the DosageForm enum. */
  dosageForms: string[]
  /** Validated-decimal strings, same contract as GET /api/products. */
  priceMin?: string
  priceMax?: string
  inStockOnly?: true
  kosher?: true
  glutenFree?: true
  vegan?: true
}

export type ExtractionResult =
  | { kind: 'criteria'; criteria: ExtractedCriteriaNames }
  | { kind: 'clarify'; question: string }

export interface AIProvider {
  /**
   * Stage 1 — translate free text into criteria, or ask one clarifying
   * question. `signal` aborts on the route's timeout: the mock ignores it,
   * but the seam must exist NOW (review finding) — without it a future
   * vendor call keeps running (and billing) after the 504 already went out,
   * and retrofitting cancellation onto a shipped interface is churn.
   */
  extractCriteria(
    message: string,
    history: ChatTurn[],
    lang: AgentLang,
    signal?: AbortSignal,
  ): Promise<ExtractionResult>
  /**
   * Stage 3 — one short explanation per product, in order. The route
   * validates the result (length, count, no unknown-product mentions) —
   * a provider's prose is never trusted as-is (AI_SAFETY_RULES layer 4).
   */
  explainProducts(
    products: PublicCatalogProduct[],
    message: string,
    lang: AgentLang,
    signal?: AbortSignal,
  ): Promise<string[]>
}

/**
 * AI_PROVIDER env var selects the implementation at startup.
 * 🔴 Unknown or missing value ⇒ mock (plan §11.2) — the server never refuses
 * to boot over an AI config, and never reaches for a vendor by default.
 * The factory is async-imported by the route factory so tests can inject a
 * provider directly instead.
 */
export async function resolveAIProvider(): Promise<AIProvider> {
  // 🔴 THE NEVER-REFUSES-TO-BOOT INVARIANT IS DEFENDED HERE, inside the
  // factory (review finding) — index.ts top-level-awaits this call, so a
  // throw would abort the WHOLE server, catalogue and checkout included.
  // Any failure constructing a provider falls back to the mock, loudly.
  try {
    const configured = process.env.AI_PROVIDER
    switch (configured) {
      // DEC-094 — the config exercise DEC-006 promised: one case, one file.
      case 'groq': {
        const apiKey = (process.env.GROQ_API_KEY ?? '').trim()
        if (apiKey === '') {
          // 🔴 LOUD fallback, never a boot failure (DEC-094 item 5): the
          // selection asked for Groq but the user's key is absent — say so
          // once, serve the mock, never log anything key-shaped.
          console.error(
            '[ai] AI_PROVIDER=groq but GROQ_API_KEY is not set — falling back to MockProvider',
          )
          break
        }
        // 🔴 SHAPE GUARD (review — a real leak path): a key carrying a
        // stray control/non-ASCII character (a CRLF paste artefact, a
        // smart quote) makes Node's Headers constructor THROW with the
        // header VALUE inside the TypeError message — which the route
        // would then console.error, putting the key in the logs. Validate
        // to printable ASCII here and fall back loudly WITHOUT ever
        // printing the value.
        if (!/^[\x21-\x7e]+$/.test(apiKey)) {
          console.error(
            '[ai] AI_PROVIDER=groq but GROQ_API_KEY contains characters that cannot travel in an HTTP header (re-paste it without quotes or line breaks) — falling back to MockProvider',
          )
          break
        }
        const { GroqProvider } = await import('./groqProvider.js')
        return new GroqProvider({ apiKey, model: process.env.GROQ_MODEL })
      }
      case 'mock':
      default:
        break
    }
    const { MockProvider } = await import('./mockProvider.js')
    return new MockProvider()
  } catch (error) {
    console.error('[ai] provider construction failed — falling back to MockProvider', error)
    const { MockProvider } = await import('./mockProvider.js')
    return new MockProvider()
  }
}
