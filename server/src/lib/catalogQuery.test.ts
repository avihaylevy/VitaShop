import { describe, expect, it } from 'vitest'
import { CANONICAL_CATEGORIES } from './catalogCategories.js'
import {
  MAX_REPEATABLE_VALUES,
  type RawCatalogQuery,
  parseCatalogProductsQuery,
} from './catalogQuery.js'

const VALID_UUID_A = '11111111-1111-4111-8111-111111111111'
const VALID_UUID_B = '22222222-2222-4222-8222-222222222222'
const VALID_CATEGORY_SLUG = CANONICAL_CATEGORIES[0]!.slug

function makeUuids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const suffix = (i + 1).toString(16).padStart(12, '0')
    return `00000000-0000-4000-8000-${suffix}`
  })
}

function expectOk(raw: RawCatalogQuery) {
  const result = parseCatalogProductsQuery(raw)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('expected ok result')
  return result.query
}

function expectInvalid(raw: RawCatalogQuery) {
  const result = parseCatalogProductsQuery(raw)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected invalid result')
  expect(result.error.code).toBe('INVALID_QUERY_PARAMETER')
  return result.error
}

function expectUnsupported(raw: RawCatalogQuery) {
  const result = parseCatalogProductsQuery(raw)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected unsupported result')
  expect(result.error.code).toBe('UNSUPPORTED_QUERY_PARAMETER')
  return result.error
}

describe('parseCatalogProductsQuery — regression / baseline', () => {
  it('no query params at all -> defaults, ok', () => {
    const query = expectOk({})
    expect(query).toEqual({
      q: undefined,
      category: undefined,
      brand: [],
      ingredient: [],
      healthGoal: [],
      dosageForm: [],
      minPrice: undefined,
      maxPrice: undefined,
      inStock: undefined,
      kosher: undefined,
      glutenFree: undefined,
      vegan: undefined,
      sort: 'newest',
      page: 1,
    })
  })

  it('an unknown param -> UNSUPPORTED_QUERY_PARAMETER naming it', () => {
    const error = expectUnsupported({ foo: 'bar' })
    expect(error.fields).toEqual(['foo'])
    expect(error.message).toBe('Unsupported query parameter(s): foo')
  })

  it('multiple unknown params -> all named, sorted', () => {
    const error = expectUnsupported({ zeta: '1', alpha: '2' })
    expect(error.fields).toEqual(['alpha', 'zeta'])
  })

  it('pageSize is rejected outright — not a supported parameter (TEST-013 ceiling clause)', () => {
    const error = expectUnsupported({ pageSize: '10000' })
    expect(error.fields).toEqual(['pageSize'])
  })

  it('an unsupported param alongside otherwise-valid params still rejects as unsupported', () => {
    const error = expectUnsupported({ category: VALID_CATEGORY_SLUG, foo: 'x' })
    expect(error.fields).toEqual(['foo'])
  })
})

describe('parseCatalogProductsQuery — q', () => {
  it('trims surrounding whitespace', () => {
    expect(expectOk({ q: '  omega  ' }).q).toBe('omega')
  })

  it('accepts exactly 1 char after trim', () => {
    expect(expectOk({ q: 'a' }).q).toBe('a')
  })

  it('accepts exactly 80 chars after trim', () => {
    const term = 'a'.repeat(80)
    expect(expectOk({ q: term }).q).toBe(term)
  })

  it('rejects empty after trim', () => {
    const error = expectInvalid({ q: '   ' })
    expect(error.fields).toEqual(['q'])
  })

  it('rejects an empty string', () => {
    expectInvalid({ q: '' })
  })

  it('rejects 81 chars after trim', () => {
    expectInvalid({ q: 'a'.repeat(81) })
  })

  it('rejects a duplicated single-value q', () => {
    const error = expectInvalid({ q: ['a', 'b'] })
    expect(error.fields).toEqual(['q'])
  })

  it('does not implement search execution — the parsed value is the trimmed literal term only', () => {
    expect(expectOk({ q: '50%' }).q).toBe('50%')
  })
})

describe('parseCatalogProductsQuery — category', () => {
  it('accepts every canonical slug', () => {
    for (const { slug } of CANONICAL_CATEGORIES) {
      expect(expectOk({ category: slug }).category).toBe(slug)
    }
  })

  it('rejects an unknown slug', () => {
    const error = expectInvalid({ category: 'not-a-real-category' })
    expect(error.fields).toEqual(['category'])
  })

  it('rejects an empty value', () => {
    expectInvalid({ category: '' })
  })

  it('rejects a display name instead of a slug', () => {
    expectInvalid({ category: CANONICAL_CATEGORIES[0]!.nameEn })
  })

  it('rejects a duplicated single-value category', () => {
    const error = expectInvalid({ category: [VALID_CATEGORY_SLUG, VALID_CATEGORY_SLUG] })
    expect(error.fields).toEqual(['category'])
  })
})

describe('parseCatalogProductsQuery — repeatable ID params (brand/ingredient/healthGoal)', () => {
  for (const field of ['brand', 'ingredient', 'healthGoal'] as const) {
    describe(field, () => {
      it('accepts a single valid id as an array of one', () => {
        expect(expectOk({ [field]: VALID_UUID_A })[field]).toEqual([VALID_UUID_A])
      })

      it('accepts repeated valid ids, order preserved, no dedup invented', () => {
        expect(expectOk({ [field]: [VALID_UUID_A, VALID_UUID_B] })[field]).toEqual([
          VALID_UUID_A,
          VALID_UUID_B,
        ])
      })

      it('rejects a malformed id', () => {
        const error = expectInvalid({ [field]: 'not-a-uuid' })
        expect(error.fields).toEqual([field])
      })

      it('rejects an empty value', () => {
        expectInvalid({ [field]: '' })
      })

      it(`accepts exactly ${MAX_REPEATABLE_VALUES} values`, () => {
        const ids = makeUuids(MAX_REPEATABLE_VALUES)
        expect(expectOk({ [field]: ids })[field]).toEqual(ids)
      })

      it(`rejects ${MAX_REPEATABLE_VALUES + 1} values, naming the field, without truncating`, () => {
        const ids = makeUuids(MAX_REPEATABLE_VALUES + 1)
        const error = expectInvalid({ [field]: ids })
        expect(error.fields).toEqual([field])
      })
    })
  }

  it('separate repeatable groups do not share one combined ceiling', () => {
    const brandIds = makeUuids(MAX_REPEATABLE_VALUES)
    const ingredientIds = makeUuids(MAX_REPEATABLE_VALUES).map((id) => id.replace('0000', '1111'))
    const query = expectOk({ brand: brandIds, ingredient: ingredientIds })
    expect(query.brand).toHaveLength(MAX_REPEATABLE_VALUES)
    expect(query.ingredient).toHaveLength(MAX_REPEATABLE_VALUES)
  })

  it('one group over its ceiling does not affect an unrelated valid group', () => {
    const tooManyBrands = makeUuids(MAX_REPEATABLE_VALUES + 1)
    const error = expectInvalid({ brand: tooManyBrands, ingredient: VALID_UUID_A })
    expect(error.fields).toEqual(['brand'])
  })
})

describe('parseCatalogProductsQuery — dosageForm', () => {
  it('accepts every frozen enum value', () => {
    for (const value of ['CAPSULE', 'TABLET', 'DROPS', 'POWDER', 'SYRUP']) {
      expect(expectOk({ dosageForm: value }).dosageForm).toEqual([value])
    }
  })

  it('accepts repeated values', () => {
    expect(expectOk({ dosageForm: ['CAPSULE', 'TABLET'] }).dosageForm).toEqual(['CAPSULE', 'TABLET'])
  })

  it('rejects an unknown value', () => {
    const error = expectInvalid({ dosageForm: 'LIQUID' })
    expect(error.fields).toEqual(['dosageForm'])
  })

  it('rejects a lowercase variant — enum identifiers are exact', () => {
    expectInvalid({ dosageForm: 'capsule' })
  })

  it(`accepts exactly ${MAX_REPEATABLE_VALUES} values and rejects ${MAX_REPEATABLE_VALUES + 1}`, () => {
    const values = ['CAPSULE', 'TABLET', 'DROPS', 'POWDER', 'SYRUP', 'CAPSULE', 'TABLET', 'DROPS', 'POWDER', 'SYRUP']
    expect(expectOk({ dosageForm: values }).dosageForm).toHaveLength(10)
    const error = expectInvalid({ dosageForm: [...values, 'CAPSULE'] })
    expect(error.fields).toEqual(['dosageForm'])
  })
})

describe('parseCatalogProductsQuery — minPrice / maxPrice', () => {
  it('accepts the boundary values 0 and 99999.99', () => {
    const query = expectOk({ minPrice: '0', maxPrice: '99999.99' })
    expect(query.minPrice).toBe('0')
    expect(query.maxPrice).toBe('99999.99')
  })

  it('accepts an integer-only value', () => {
    expect(expectOk({ minPrice: '10' }).minPrice).toBe('10')
  })

  it('accepts one decimal place', () => {
    expect(expectOk({ minPrice: '10.5' }).minPrice).toBe('10.5')
  })

  it('rejects a negative value', () => {
    const error = expectInvalid({ minPrice: '-1' })
    expect(error.fields).toEqual(['minPrice'])
  })

  it('rejects more than 2 decimal places', () => {
    expectInvalid({ minPrice: '10.999' })
  })

  it('rejects a value above the ceiling', () => {
    expectInvalid({ maxPrice: '100000' })
  })

  it('rejects a non-numeric value', () => {
    expectInvalid({ minPrice: 'abc' })
  })

  it('rejects minPrice > maxPrice, naming both fields', () => {
    const error = expectInvalid({ minPrice: '50', maxPrice: '10' })
    expect(error.fields).toEqual(['minPrice', 'maxPrice'])
  })

  it('accepts minPrice === maxPrice', () => {
    const query = expectOk({ minPrice: '50', maxPrice: '50' })
    expect(query.minPrice).toBe('50')
    expect(query.maxPrice).toBe('50')
  })

  it('an out-of-range minPrice does not also spuriously fail the ordering check against a valid maxPrice', () => {
    const error = expectInvalid({ minPrice: '100000', maxPrice: '10' })
    expect(error.fields).toEqual(['minPrice'])
  })
})

describe('parseCatalogProductsQuery — dietary flags (DEC-078/DEC-083)', () => {
  it.each(['kosher', 'glutenFree', 'vegan'] as const)('%s=true parses to true', (key) => {
    expect(expectOk({ [key]: 'true' })[key]).toBe(true)
  })

  it.each(['kosher', 'glutenFree', 'vegan'] as const)('%s absent parses to undefined', (key) => {
    expect(expectOk({})[key]).toBeUndefined()
  })

  it.each(['kosher', 'glutenFree', 'vegan'] as const)(
    '%s=false is INVALID, same literal contract as inStock',
    (key) => {
      const error = expectInvalid({ [key]: 'false' })
      expect(error.fields).toEqual([key])
    },
  )

  it('all three together parse independently', () => {
    const query = expectOk({ kosher: 'true', glutenFree: 'true', vegan: 'true' })
    expect(query.kosher).toBe(true)
    expect(query.glutenFree).toBe(true)
    expect(query.vegan).toBe(true)
  })
})

describe('parseCatalogProductsQuery — inStock', () => {
  it('accepts the literal "true"', () => {
    expect(expectOk({ inStock: 'true' }).inStock).toBe(true)
  })

  it('is absent (undefined) when not supplied', () => {
    expect(expectOk({}).inStock).toBeUndefined()
  })

  it('rejects "false" — the frozen contract has no false branch, absence means unfiltered', () => {
    const error = expectInvalid({ inStock: 'false' })
    expect(error.fields).toEqual(['inStock'])
  })

  it('rejects "1"', () => {
    expectInvalid({ inStock: '1' })
  })

  it('rejects an empty value', () => {
    expectInvalid({ inStock: '' })
  })
})

describe('parseCatalogProductsQuery — sort', () => {
  it('defaults to newest when absent', () => {
    expect(expectOk({}).sort).toBe('newest')
  })

  it('accepts every frozen value', () => {
    for (const value of ['price_asc', 'price_desc', 'newest', 'popularity']) {
      expect(expectOk({ sort: value }).sort).toBe(value)
    }
  })

  it('rejects an unknown value', () => {
    const error = expectInvalid({ sort: 'relevance' })
    expect(error.fields).toEqual(['sort'])
  })
})

describe('parseCatalogProductsQuery — page', () => {
  it('defaults to 1 when absent', () => {
    expect(expectOk({}).page).toBe(1)
  })

  it('accepts a positive integer', () => {
    expect(expectOk({ page: '3' }).page).toBe(3)
  })

  it('rejects 0', () => {
    const error = expectInvalid({ page: '0' })
    expect(error.fields).toEqual(['page'])
  })

  it('rejects a negative number', () => {
    expectInvalid({ page: '-1' })
  })

  it('rejects a non-integer', () => {
    expectInvalid({ page: '1.5' })
  })

  it('rejects a leading-zero form', () => {
    expectInvalid({ page: '01' })
  })

  it('rejects a non-numeric value', () => {
    expectInvalid({ page: 'abc' })
  })

  it('never accepts a client-supplied pageSize even alongside a valid page', () => {
    const error = expectUnsupported({ page: '2', pageSize: '50' })
    expect(error.fields).toEqual(['pageSize'])
  })

  describe('safe-integer boundary (Codex correction)', () => {
    it('accepts page = 1', () => {
      expect(expectOk({ page: '1' }).page).toBe(1)
    })

    it('accepts page = Number.MAX_SAFE_INTEGER', () => {
      const value = String(Number.MAX_SAFE_INTEGER)
      expect(expectOk({ page: value }).page).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('rejects page = Number.MAX_SAFE_INTEGER + 1', () => {
      const value = String(Number.MAX_SAFE_INTEGER + 1)
      const error = expectInvalid({ page: value })
      expect(error.fields).toEqual(['page'])
    })

    it('rejects an extremely long digit string (e.g. 1e+50-scale input) without ever producing an unsafe number', () => {
      const value = '1' + '0'.repeat(50)
      const error = expectInvalid({ page: value })
      expect(error.fields).toEqual(['page'])
    })

    it('rejects a digit string long enough to overflow to Infinity if it were ever parsed', () => {
      // 400 digits: Number.parseInt on a string this long would yield
      // Infinity if it reached parsing at all. The length bound must reject
      // it before Number.parseInt is ever called.
      const value = '9'.repeat(400)
      const error = expectInvalid({ page: value })
      expect(error.fields).toEqual(['page'])
    })

    it('rejects a 16-digit value that is within digit-length bounds but exceeds MAX_SAFE_INTEGER', () => {
      // 16 nines: same digit count as Number.MAX_SAFE_INTEGER (16 digits)
      // but numerically larger and therefore not a safe integer.
      const value = '9999999999999999'
      expect(value.length).toBe(String(Number.MAX_SAFE_INTEGER).length)
      const error = expectInvalid({ page: value })
      expect(error.fields).toEqual(['page'])
    })

    it('existing invalid forms remain rejected after the fix', () => {
      expectInvalid({ page: '0' })
      expectInvalid({ page: '-1' })
      expectInvalid({ page: '1.5' })
      expectInvalid({ page: '01' })
      expectInvalid({ page: 'abc' })
    })

    it('default page remains 1 when absent', () => {
      expect(expectOk({}).page).toBe(1)
    })
  })
})

describe('parseCatalogProductsQuery — accumulation and determinism', () => {
  it('accumulates multiple independent violations into one response, in canonical field order', () => {
    const error = expectInvalid({ category: 'nope', sort: 'nope', page: 'nope' })
    expect(error.fields).toEqual(['category', 'sort', 'page'])
  })

  it('field order in the response does not depend on input key order', () => {
    const error = expectInvalid({ page: 'nope', category: 'nope' })
    expect(error.fields).toEqual(['category', 'page'])
  })

  it('is deterministic across repeated calls with the same input', () => {
    const raw = { sort: 'nope', minPrice: '-1' }
    const first = parseCatalogProductsQuery(raw)
    const second = parseCatalogProductsQuery(raw)
    expect(first).toEqual(second)
  })

  it('a fully valid combined query resolves every field together', () => {
    const query = expectOk({
      q: 'omega',
      category: VALID_CATEGORY_SLUG,
      brand: [VALID_UUID_A, VALID_UUID_B],
      dosageForm: 'CAPSULE',
      ingredient: VALID_UUID_A,
      healthGoal: [VALID_UUID_A, VALID_UUID_B],
      minPrice: '10',
      maxPrice: '200',
      inStock: 'true',
      kosher: 'true',
      glutenFree: 'true',
      vegan: 'true',
      sort: 'price_asc',
      page: '2',
    })
    expect(query).toEqual({
      q: 'omega',
      category: VALID_CATEGORY_SLUG,
      brand: [VALID_UUID_A, VALID_UUID_B],
      ingredient: [VALID_UUID_A],
      healthGoal: [VALID_UUID_A, VALID_UUID_B],
      dosageForm: ['CAPSULE'],
      minPrice: '10',
      maxPrice: '200',
      inStock: true,
      kosher: true,
      glutenFree: true,
      vegan: true,
      sort: 'price_asc',
      page: 2,
    })
  })
})

describe('parseCatalogProductsQuery — malformed shapes (never silently coerced)', () => {
  it('rejects a nested-object value for a known param', () => {
    const error = expectInvalid({ category: { nested: 'x' } as unknown as string })
    expect(error.fields).toEqual(['category'])
  })

  it('rejects a non-string array entry for a repeatable param', () => {
    const error = expectInvalid({ brand: [VALID_UUID_A, 123 as unknown as string] })
    expect(error.fields).toEqual(['brand'])
  })
})
