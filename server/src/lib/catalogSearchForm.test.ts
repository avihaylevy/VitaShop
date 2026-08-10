import { describe, expect, it } from 'vitest'
import { assertPrismaSearchFormSupported, buildSearchWhere, escapeLikeLiteral } from './catalogSearchForm.js'

describe('§3a stop condition — Prisma search form', () => {
  it('the frozen contains/mode:insensitive shape compiles and covers every §3 searched field', () => {
    // This never touches the database — it only proves (at compile time via
    // the file's own type annotations, and here again at runtime) that the
    // object literal Checkpoint E will send to Prisma is well-formed per the
    // generated Prisma.ProductWhereInput type. A live query is Checkpoint E.
    const shape = assertPrismaSearchFormSupported()
    expect(shape.nameHe).toEqual({ contains: 'x', mode: 'insensitive' })
    expect(shape.nameEn).toEqual({ contains: 'x', mode: 'insensitive' })
    expect(shape.brand).toEqual({ name: { contains: 'x', mode: 'insensitive' } })
    expect(shape.ingredients).toBeDefined()
    expect(shape.healthGoals).toBeDefined()
    expect(shape.category).toBeDefined()
  })
})

describe('escapeLikeLiteral', () => {
  it('escapes a literal backslash', () => {
    expect(escapeLikeLiteral('a\\b')).toBe('a\\\\b')
  })

  it('escapes a literal percent', () => {
    expect(escapeLikeLiteral('50%')).toBe('50\\%')
  })

  it('escapes a literal underscore', () => {
    expect(escapeLikeLiteral('vitamin_d')).toBe('vitamin\\_d')
  })

  it('escapes backslash before percent/underscore so a user backslash cannot corrupt a later escape', () => {
    // A literal `\_` must become `\\` + `\_`, never `\\_` (which would read
    // back as an escaped backslash followed by a literal underscore wildcard).
    expect(escapeLikeLiteral('\\_')).toBe('\\\\\\_')
    expect(escapeLikeLiteral('\\%')).toBe('\\\\\\%')
  })

  it('a bare "%" does not become match-all — it is escaped to a literal-percent search term', () => {
    const escaped = escapeLikeLiteral('%')
    expect(escaped).toBe('\\%')
    expect(escaped).not.toBe('%')
  })

  it('leaves a plain Hebrew substring untouched', () => {
    expect(escapeLikeLiteral('ויטמין')).toBe('ויטמין')
  })

  it('leaves a plain English substring untouched', () => {
    expect(escapeLikeLiteral('omega')).toBe('omega')
  })

  it('leaves a mixed-language substring untouched when it has no metacharacters', () => {
    expect(escapeLikeLiteral('Omega ויטמין 3')).toBe('Omega ויטמין 3')
  })

  it('escapes metacharacters inside a mixed-language term', () => {
    expect(escapeLikeLiteral('ויטמין_D 100%')).toBe('ויטמין\\_D 100\\%')
  })

  it('is idempotent-safe: escaping does not introduce new unescaped metacharacters', () => {
    const escaped = escapeLikeLiteral('100% off_sale')
    expect(escaped).toBe('100\\% off\\_sale')
    // The only underscores/percents remaining are the frozen escape pairs.
    expect(escaped.match(/(?<!\\)[%_]/g)).toBeNull()
  })
})

describe('buildSearchWhere', () => {
  it('returns undefined when q is undefined — no vacuous clause added', () => {
    expect(buildSearchWhere(undefined)).toBeUndefined()
  })

  it('is an OR across every §3 searched field, each using contains + mode:insensitive on the escaped term', () => {
    const where = buildSearchWhere('omega')
    const expectedContains = { contains: 'omega', mode: 'insensitive' as const }
    expect(where).toEqual({
      OR: [
        { nameHe: expectedContains },
        { nameEn: expectedContains },
        { descriptionHe: expectedContains },
        { descriptionEn: expectedContains },
        { brand: { name: expectedContains } },
        { ingredients: { some: { activeIngredient: { name: expectedContains } } } },
        { category: { nameHe: expectedContains } },
        { category: { nameEn: expectedContains } },
        { healthGoals: { some: { healthGoal: { nameHe: expectedContains } } } },
        { healthGoals: { some: { healthGoal: { nameEn: expectedContains } } } },
      ],
    })
  })

  it('escapes the term before building the clause — a bare "%" becomes a literal-percent contains, not match-all', () => {
    const where = buildSearchWhere('%')
    const or = where?.OR as { nameHe: { contains: string } }[]
    expect(or[0]!.nameHe.contains).toBe('\\%')
  })

  it('escapes "_" the same way', () => {
    const where = buildSearchWhere('vitamin_d')
    const or = where?.OR as { nameHe: { contains: string } }[]
    expect(or[0]!.nameHe.contains).toBe('vitamin\\_d')
  })

  it('escapes a literal backslash the same way', () => {
    const where = buildSearchWhere('a\\b')
    const or = where?.OR as { nameHe: { contains: string } }[]
    expect(or[0]!.nameHe.contains).toBe('a\\\\b')
  })

  it('does not re-validate or re-trim q — Checkpoint C already guarantees a trimmed 1-80 char term', () => {
    // Passing an already-invalid shape (would never happen via the real
    // route, since C rejects it first) still just escapes verbatim — this
    // function has no opinion on length/emptiness.
    const where = buildSearchWhere('  spaced  ')
    const or = where?.OR as { nameHe: { contains: string } }[]
    expect(or[0]!.nameHe.contains).toBe('  spaced  ')
  })
})
