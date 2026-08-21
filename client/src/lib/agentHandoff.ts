// MILESTONE-011 Checkpoint C — REQ-F-077's handoff: the agent's resolved
// criteria carried into /catalog WITH THE FILTERS PRESERVED.
//
// The server's handoff params use GET /api/products' own parameter names,
// which are ALSO /catalog's URL parameter names (catalogUrlState.ts §5 —
// the client's URL is a faithful projection of the API contract). So the
// mapping here is a serialization, not a translation — and the round-trip
// test proves it by feeding the produced URL through /catalog's OWN parser
// and comparing criterion for criterion.

import { CANONICAL_PARAM_ORDER, isPresent } from '../features/catalog/catalogUrlState'

/**
 * The params /catalog reads MORE THAN ONCE of. Everything else is
 * single-valued: a handoff that (wrongly) carries an array for a scalar
 * param keeps only its first entry — /catalog's own firstValue() would do
 * exactly that anyway, and emitting `maxPrice=20&maxPrice=100` would make
 * the URL claim criteria the page silently halves (review finding).
 */
const REPEATABLE_PARAMS: ReadonlySet<string> = new Set([
  'brand',
  'dosageForm',
  'ingredient',
  'healthGoal',
])

/**
 * The /catalog navigation target for a handoff, e.g.
 * "/catalog?ingredient=<id>&maxPrice=100".
 *
 * 🔴 The allowlist is CANONICAL_PARAM_ORDER — the real /catalog parameter
 * set in its frozen order (review finding: keying off the client STATE
 * type's keys admitted `pageRaw`, an internal field that is not a URL
 * parameter, and made the emitted order an accident of an object literal).
 * Unknown keys and empty values are DROPPED, not forwarded — a handoff
 * link must always be a URL the catalogue reads cleanly, never one that
 * would 400 if replayed against GET /api/products.
 */
export function handoffToCatalogPath(handoff: Record<string, string | string[]>): string {
  const params = new URLSearchParams()
  for (const key of CANONICAL_PARAM_ORDER) {
    const value = handoff[key]
    if (value === undefined) continue
    const entries = Array.isArray(value) ? value : [value]
    const kept = REPEATABLE_PARAMS.has(key) ? entries : entries.slice(0, 1)
    for (const entry of kept) {
      if (!isPresent(entry)) continue
      params.append(key, entry)
    }
  }
  const query = params.toString()
  return query === '' ? '/catalog' : `/catalog?${query}`
}

/**
 * Review consolidation: the ONE guard for "this handoff actually carries
 * criteria" — written three times (announcement, success link, empty-state
 * link) before; a drift between them made the live region voice a link the
 * screen did not show, or the reverse.
 */
export function hasCriteriaHandoff(
  handoff: Record<string, string | string[]> | null,
): handoff is Record<string, string | string[]> {
  return handoff !== null && handoffToCatalogPath(handoff) !== '/catalog'
}
