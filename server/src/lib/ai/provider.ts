// MILESTONE-011 Checkpoint A — the AIProvider interface (ARCH-001, DEC-006).
//
// 🔴 PROVIDER-NEUTRAL BY DECISION: DEC-091 O5 deferred the real-provider
// choice, so this module defines the seam and nothing vendor-shaped exists
// anywhere. No code outside a provider's own implementation file may import a
// vendor SDK (DEC-006); today the only implementation is MockProvider
// (DEC-014 — an agent never obtains, generates, or configures an API key).
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
      // Today every case falls through to the mock: DEC-091 O5 deferred the
      // vendor, so no other implementation exists to select. A future
      // provider is one new case + one implementation file — the DEC-006
      // config exercise this switch exists to make honest.
      case 'mock':
      default: {
        const { MockProvider } = await import('./mockProvider.js')
        return new MockProvider()
      }
    }
  } catch (error) {
    console.error('[ai] provider construction failed — falling back to MockProvider', error)
    const { MockProvider } = await import('./mockProvider.js')
    return new MockProvider()
  }
}
