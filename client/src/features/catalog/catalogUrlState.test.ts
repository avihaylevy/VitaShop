import { describe, expect, it } from 'vitest'
import {
  buildCatalogSearchParams,
  canonicalizePastTheEndPage,
  DEFAULT_PAGE,
  DEFAULT_SORT,
  EMPTY_CATALOG_URL_STATE,
  nextCatalogUrlState,
  parseCatalogUrlState,
  type CatalogUrlState,
} from './catalogUrlState'

function params(query: string): URLSearchParams {
  return new URLSearchParams(query)
}

describe('parseCatalogUrlState', () => {
  it('a bare /catalog (no query string) parses to the empty/default state', () => {
    expect(parseCatalogUrlState(params(''))).toEqual(EMPTY_CATALOG_URL_STATE)
  })

  it('parses q and category as single values', () => {
    const state = parseCatalogUrlState(params('q=omega&category=vitamins'))
    expect(state.q).toBe('omega')
    expect(state.category).toBe('vitamins')
  })

  it('parses repeated ID-valued params into arrays, never comma-split', () => {
    const state = parseCatalogUrlState(params('brand=b1&brand=b2&ingredient=i1'))
    expect(state.brand).toEqual(['b1', 'b2'])
    expect(state.ingredient).toEqual(['i1'])
    expect(state.healthGoal).toEqual([])
  })

  it('parses dosageForm as a repeated array', () => {
    expect(parseCatalogUrlState(params('dosageForm=CAPSULE&dosageForm=TABLET')).dosageForm).toEqual([
      'CAPSULE',
      'TABLET',
    ])
  })

  it('parses minPrice/maxPrice as raw strings, never coerced to numbers', () => {
    const state = parseCatalogUrlState(params('minPrice=10.50&maxPrice=99999.99'))
    expect(state.minPrice).toBe('10.50')
    expect(state.maxPrice).toBe('99999.99')
  })

  it('inStock is parsed through faithfully — the server, not this module, decides whether the value is valid', () => {
    expect(parseCatalogUrlState(params('inStock=true')).inStock).toBe('true')
    // These are NOT normalized to false/undefined — the server's
    // z.literal('true') schema rejects them with a 400, and that 400 must
    // still be reachable, so the exact malformed literal survives parsing.
    expect(parseCatalogUrlState(params('inStock=false')).inStock).toBe('false')
    expect(parseCatalogUrlState(params('inStock=1')).inStock).toBe('1')
  })

  it('inStock is undefined (not a false-ish string) when the param is absent', () => {
    expect(parseCatalogUrlState(params('')).inStock).toBeUndefined()
  })

  it('sort defaults to "newest" when absent', () => {
    expect(parseCatalogUrlState(params('')).sort).toBe(DEFAULT_SORT)
  })

  it('sort is parsed through faithfully even when it is not one of the four frozen values — never silently corrected', () => {
    expect(parseCatalogUrlState(params('sort=bogus')).sort).toBe('bogus')
  })

  it('page defaults to 1 when absent, with no raw value carried', () => {
    const state = parseCatalogUrlState(params(''))
    expect(state.page).toBe(DEFAULT_PAGE)
    expect(state.pageRaw).toBeUndefined()
  })

  it('page parses a well-formed positive integer, with no raw value carried (page is already valid)', () => {
    const state = parseCatalogUrlState(params('page=3'))
    expect(state.page).toBe(3)
    expect(state.pageRaw).toBeUndefined()
  })

  it('a malformed page becomes NaN, never silently defaulted to 1 — and the exact raw literal is preserved in pageRaw', () => {
    for (const raw of ['abc', '0', '-1', '1.5']) {
      const state = parseCatalogUrlState(params(`page=${raw}`))
      expect(Number.isNaN(state.page)).toBe(true)
      expect(state.pageRaw).toBe(raw)
    }
  })

  it('round-trips a fully populated query string', () => {
    const query =
      'q=omega&category=vitamins&brand=b1&brand=b2&dosageForm=CAPSULE&ingredient=i1&healthGoal=h1&healthGoal=h2&minPrice=10&maxPrice=90&inStock=true&sort=price_asc&page=2'
    const state = parseCatalogUrlState(params(query))
    expect(state).toEqual({
      q: 'omega',
      category: 'vitamins',
      brand: ['b1', 'b2'],
      dosageForm: ['CAPSULE'],
      ingredient: ['i1'],
      healthGoal: ['h1', 'h2'],
      minPrice: '10',
      maxPrice: '90',
      inStock: 'true',
      sort: 'price_asc',
      page: 2,
      pageRaw: undefined,
    })
  })
})

describe('buildCatalogSearchParams', () => {
  it('the empty/default state serializes to an empty query string — the default view is a bare /catalog', () => {
    expect(buildCatalogSearchParams(EMPTY_CATALOG_URL_STATE).toString()).toBe('')
  })

  it('omits sort when it is the default ("newest")', () => {
    const state: CatalogUrlState = { ...EMPTY_CATALOG_URL_STATE, sort: 'newest' }
    expect(buildCatalogSearchParams(state).has('sort')).toBe(false)
  })

  it('includes a non-default sort', () => {
    const state: CatalogUrlState = { ...EMPTY_CATALOG_URL_STATE, sort: 'price_asc' }
    expect(buildCatalogSearchParams(state).get('sort')).toBe('price_asc')
  })

  it('omits page when it is the default (1)', () => {
    expect(buildCatalogSearchParams({ ...EMPTY_CATALOG_URL_STATE, page: 1 }).has('page')).toBe(false)
  })

  it('includes a non-default page', () => {
    expect(buildCatalogSearchParams({ ...EMPTY_CATALOG_URL_STATE, page: 3 }).get('page')).toBe('3')
  })

  it('a malformed page (NaN) emits the caller\'s exact raw literal via pageRaw, never the string "NaN" and never silently dropped', () => {
    const state: CatalogUrlState = { ...EMPTY_CATALOG_URL_STATE, page: Number.NaN, pageRaw: 'abc' }
    expect(buildCatalogSearchParams(state).get('page')).toBe('abc')
  })

  it('a malformed page with no pageRaw (constructed directly, not via parse) omits page rather than inventing a value', () => {
    const state: CatalogUrlState = { ...EMPTY_CATALOG_URL_STATE, page: Number.NaN, pageRaw: undefined }
    expect(buildCatalogSearchParams(state).has('page')).toBe(false)
  })

  it('omits inStock when absent (undefined)', () => {
    expect(buildCatalogSearchParams({ ...EMPTY_CATALOG_URL_STATE, inStock: undefined }).has('inStock')).toBe(false)
  })

  it('omits inStock when it is an empty string', () => {
    expect(buildCatalogSearchParams({ ...EMPTY_CATALOG_URL_STATE, inStock: '' }).has('inStock')).toBe(false)
  })

  it('includes inStock=true verbatim', () => {
    expect(buildCatalogSearchParams({ ...EMPTY_CATALOG_URL_STATE, inStock: 'true' }).get('inStock')).toBe('true')
  })

  it('passes a malformed inStock value through verbatim — this module does not decide it is invalid', () => {
    expect(buildCatalogSearchParams({ ...EMPTY_CATALOG_URL_STATE, inStock: 'false' }).get('inStock')).toBe('false')
    expect(buildCatalogSearchParams({ ...EMPTY_CATALOG_URL_STATE, inStock: '1' }).get('inStock')).toBe('1')
  })

  it('omits category/minPrice/maxPrice when they are empty strings, exactly like q', () => {
    const cleared: CatalogUrlState = { ...EMPTY_CATALOG_URL_STATE, category: '', minPrice: '', maxPrice: '', q: '' }
    const built = buildCatalogSearchParams(cleared)
    expect(built.has('q')).toBe(false)
    expect(built.has('category')).toBe(false)
    expect(built.has('minPrice')).toBe(false)
    expect(built.has('maxPrice')).toBe(false)
    expect(built.toString()).toBe('')
  })

  it('emits repeated ID-valued params as repeated keys, never comma-joined', () => {
    const state: CatalogUrlState = { ...EMPTY_CATALOG_URL_STATE, brand: ['b1', 'b2'] }
    expect(buildCatalogSearchParams(state).getAll('brand')).toEqual(['b1', 'b2'])
    expect(buildCatalogSearchParams(state).toString()).not.toContain(',')
  })

  it('follows the exact §5 canonical field order', () => {
    const state: CatalogUrlState = {
      q: 'omega',
      category: 'vitamins',
      brand: ['b1'],
      dosageForm: ['CAPSULE'],
      ingredient: ['i1'],
      healthGoal: ['h1'],
      minPrice: '10',
      maxPrice: '90',
      inStock: 'true',
      kosher: 'true',
      glutenFree: 'true',
      vegan: 'true',
      sort: 'price_asc',
      page: 2,
      pageRaw: undefined,
    }
    const keys = [...buildCatalogSearchParams(state).keys()]
    expect(keys).toEqual([
      'q',
      'category',
      'brand',
      'dosageForm',
      'ingredient',
      'healthGoal',
      'minPrice',
      'maxPrice',
      'inStock',
      'kosher',
      'glutenFree',
      'vegan',
      'sort',
      'page',
    ])
  })

  it('round-trips through parseCatalogUrlState -> buildCatalogSearchParams -> parseCatalogUrlState', () => {
    const original: CatalogUrlState = {
      q: 'vitamin',
      category: 'minerals',
      brand: ['b1', 'b2'],
      dosageForm: ['CAPSULE', 'TABLET'],
      ingredient: ['i1'],
      healthGoal: ['h1', 'h2'],
      minPrice: '5.50',
      maxPrice: '150',
      inStock: 'true',
      // A mixed dietary state on purpose — presence and absence both round-trip.
      kosher: 'true',
      glutenFree: undefined,
      vegan: 'true',
      sort: 'popularity',
      page: 4,
      pageRaw: undefined,
    }
    const roundTripped = parseCatalogUrlState(buildCatalogSearchParams(original))
    expect(roundTripped).toEqual(original)
  })

  it('round-trips a malformed page losslessly, including through a second parse/build cycle', () => {
    const original = parseCatalogUrlState(params('page=abc'))
    const rebuilt = buildCatalogSearchParams(original)
    expect(rebuilt.get('page')).toBe('abc')
    const reparsed = parseCatalogUrlState(rebuilt)
    expect(reparsed).toEqual(original)
  })
})

describe('nextCatalogUrlState', () => {
  const withFilters: CatalogUrlState = { ...EMPTY_CATALOG_URL_STATE, category: 'vitamins', page: 3 }

  it('a page-only change preserves every other field', () => {
    const next = nextCatalogUrlState(withFilters, { page: 5 })
    expect(next).toEqual({ ...withFilters, page: 5 })
  })

  it('changing any non-page field resets page to 1 and clears pageRaw', () => {
    const withRawPage: CatalogUrlState = { ...withFilters, page: Number.NaN, pageRaw: 'abc' }
    const next = nextCatalogUrlState(withRawPage, { category: 'minerals' })
    expect(next.page).toBe(1)
    expect(next.pageRaw).toBeUndefined()
    expect(next.category).toBe('minerals')
  })

  it('changing q resets page to 1', () => {
    expect(nextCatalogUrlState(withFilters, { q: 'omega' }).page).toBe(1)
  })

  it('changing sort resets page to 1', () => {
    expect(nextCatalogUrlState(withFilters, { sort: 'price_asc' }).page).toBe(1)
  })

  it('a mixed change (page + another field) still resets to page 1 — page changes never accompany other changes', () => {
    const next = nextCatalogUrlState(withFilters, { page: 5, brand: ['b1'] })
    expect(next.page).toBe(1)
    expect(next.brand).toEqual(['b1'])
  })

  it('an empty changes object is a no-op (still treated as "not page-only", but nothing actually differs)', () => {
    expect(nextCatalogUrlState(withFilters, {})).toEqual({ ...withFilters, page: 1, pageRaw: undefined })
  })
})

describe('canonicalizePastTheEndPage', () => {
  const state: CatalogUrlState = { ...EMPTY_CATALOG_URL_STATE, category: 'vitamins', page: 5 }

  it('returns null when the requested page is within range', () => {
    expect(canonicalizePastTheEndPage({ ...state, page: 1 }, 100, 5)).toBeNull()
    expect(canonicalizePastTheEndPage({ ...state, page: 5 }, 100, 5)).toBeNull()
  })

  it('returns the canonical state (page -> totalPages) when past-the-end', () => {
    const result = canonicalizePastTheEndPage(state, 100, 3)
    expect(result).toEqual({ ...state, page: 3 })
  })

  it('preserves every other query parameter byte-for-byte', () => {
    const rich: CatalogUrlState = {
      q: 'omega',
      category: 'vitamins',
      brand: ['b1'],
      dosageForm: ['CAPSULE'],
      ingredient: ['i1'],
      healthGoal: ['h1'],
      minPrice: '10',
      maxPrice: '90',
      inStock: 'true',
      kosher: 'true',
      glutenFree: 'true',
      vegan: 'true',
      sort: 'price_asc',
      page: 999,
      pageRaw: undefined,
    }
    const result = canonicalizePastTheEndPage(rich, 50, 3)
    expect(result).toEqual({ ...rich, page: 3 })
  })

  it('the zero-total convention: totalItems === 0 never canonicalizes, regardless of page/totalPages', () => {
    expect(canonicalizePastTheEndPage({ ...state, page: 5 }, 0, 0)).toBeNull()
  })

  it('does not canonicalize toward totalPages === 0 even if some caller passes a positive page with totalPages 0', () => {
    // Defensive: totalItems === 0 always implies totalPages === 0 per §4a,
    // so this guard is redundant with the one above in practice, but the
    // function must never produce page: 0 under any input.
    expect(canonicalizePastTheEndPage({ ...state, page: 5 }, 0, 0)).toBeNull()
  })

  it('never "corrects" a malformed page — a NaN page returns null, not a silently invented canonical page', () => {
    const malformed: CatalogUrlState = { ...state, page: Number.NaN, pageRaw: 'abc' }
    expect(canonicalizePastTheEndPage(malformed, 100, 5)).toBeNull()
  })
})
