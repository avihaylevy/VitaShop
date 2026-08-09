import { describe, expect, it } from 'vitest'
import catalogHe from './he/catalog.json'
import catalogEn from './en/catalog.json'

/**
 * Namespace-integrity test for `catalog` — UI_IMPLEMENTATION_PLAN.md §13,
 * tier 1: "i18n key symmetry between he and en — catches the classic
 * drift". Slice 9 Checkpoint C.
 *
 * Pure JSON validation. No renderer, no i18next instance, no jsdom.
 *
 * Self-contained: the same generic validator shape already proven in
 * `cart.i18n.test.ts` is reimplemented here rather than imported, since
 * importing from another `*.test.ts` file would re-execute its `describe`
 * blocks, and Checkpoint C's allowlist does not include touching the
 * cart namespace or extracting a shared lib.
 *
 * 🔴 Proven by MUTATION, not just by asserting today's (correct) JSON —
 * each rule below has a test that clones the real locale, breaks exactly
 * one thing, and asserts the validator reports it.
 *
 * The rules:
 *   1. Both locales define the same set of BASE keys (key parity,
 *      required keys — a key missing from either side is reported).
 *   2. Both locales agree on whether each base key is pluralised.
 *   3. A non-plural key must exist at its exact raw path in BOTH locales.
 *   4. A pluralised base must carry every plural category its own
 *      language requires (Hebrew one/two/many/other, English one/other).
 *   5. A base must not mix a bare key and suffixed keys in the same locale.
 *   6. No value is empty (non-empty values).
 *   7. Interpolation placeholders match per base, including `{{category}}`
 *      on `catalogPage.emptyCategoryMessage` (placeholder parity).
 */

type LocaleTree = { [key: string]: string | LocaleTree }
type LocaleCode = 'he' | 'en'

const REQUIRED_PLURAL_CATEGORIES: Record<LocaleCode, readonly string[]> = {
  he: ['one', 'two', 'many', 'other'],
  en: ['one', 'other'],
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

type KeyIndex = Map<string, { categories: Set<string>; hasBareKey: boolean }>

function flatten(node: unknown, prefix = ''): [string, unknown][] {
  if (typeof node !== 'object' || node === null) {
    return [[prefix, node]]
  }

  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  )
}

function splitKey(rawKey: string): { base: string; category: string | null } {
  const match = PLURAL_SUFFIX.exec(rawKey)
  return match ? { base: rawKey.slice(0, match.index), category: match[1] } : { base: rawKey, category: null }
}

function indexKeys(tree: LocaleTree): KeyIndex {
  const index: KeyIndex = new Map()

  for (const [rawKey] of flatten(tree)) {
    const { base, category } = splitKey(rawKey)
    const entry = index.get(base) ?? { categories: new Set<string>(), hasBareKey: false }

    if (category === null) {
      entry.hasBareKey = true
    } else {
      entry.categories.add(category)
    }

    index.set(base, entry)
  }

  return index
}

function isPluralised(index: KeyIndex, base: string): boolean {
  return (index.get(base)?.categories.size ?? 0) > 0
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1])
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function rawKeysFor(index: KeyIndex, base: string): string[] {
  const entry = index.get(base)
  if (!entry) {
    return []
  }
  return [...(entry.hasBareKey ? [base] : []), ...[...entry.categories].map((category) => `${base}_${category}`)]
}

function valueAt(tree: LocaleTree, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (typeof node !== 'object' || node === null) {
      return undefined
    }
    return (node as Record<string, unknown>)[key]
  }, tree)
}

function placeholderUnion(tree: LocaleTree, index: KeyIndex, base: string): string[] {
  return sortedUnique(
    rawKeysFor(index, base).flatMap((rawKey) => {
      const value = valueAt(tree, rawKey)
      return typeof value === 'string' ? placeholders(value) : []
    }),
  )
}

/** Returns every contract violation as a message. An empty array means the namespace pair is sound. */
export function validateNamespacePair(he: LocaleTree, en: LocaleTree): string[] {
  const errors: string[] = []
  const index: Record<LocaleCode, KeyIndex> = { he: indexKeys(he), en: indexKeys(en) }
  const tree: Record<LocaleCode, LocaleTree> = { he, en }
  const locales: LocaleCode[] = ['he', 'en']

  const allBases = sortedUnique([...index.he.keys(), ...index.en.keys()])

  for (const base of allBases) {
    const missingIn = locales.filter((locale) => !index[locale].has(base))
    if (missingIn.length > 0) {
      errors.push(`base key "${base}" is missing in: ${missingIn.join(', ')}`)
      continue
    }

    for (const locale of locales) {
      const entry = index[locale].get(base)!
      if (entry.hasBareKey && entry.categories.size > 0) {
        errors.push(`"${base}" mixes a bare key with plural categories in ${locale}`)
      }
    }

    const pluralIn = locales.filter((locale) => isPluralised(index[locale], base))
    if (pluralIn.length === 1) {
      const nonPlural = locales.find((locale) => !pluralIn.includes(locale))
      errors.push(`"${base}" is pluralised in ${pluralIn[0]} but not in ${nonPlural}`)
      continue
    }

    if (pluralIn.length === 0) {
      for (const locale of locales) {
        if (typeof valueAt(tree[locale], base) !== 'string') {
          errors.push(`non-plural key "${base}" is not a string in ${locale}`)
        }
      }
    } else {
      for (const locale of locales) {
        const present = index[locale].get(base)!.categories
        const allowed = new Set(REQUIRED_PLURAL_CATEGORIES[locale])

        for (const category of REQUIRED_PLURAL_CATEGORIES[locale]) {
          if (!present.has(category)) {
            errors.push(`pluralised key "${base}" is missing "_${category}" in ${locale}`)
          }
        }
        if (!present.has('other')) {
          errors.push(`pluralised key "${base}" must define "_other" in ${locale}`)
        }
        for (const category of [...present].sort()) {
          if (!allowed.has(category)) {
            errors.push(`"${base}" has unexpected "_${category}" category in ${locale}`)
          }
        }
      }

      // Rule 8 — per-corresponding-category cross-locale placeholder check.
      // 🔴 The union-based check below (Rule 7) compares the UNION of
      // placeholders across all categories per locale, so dropping a
      // placeholder from one specific plural variant is invisible if any
      // OTHER variant in the same locale still carries it. This rule
      // compares he_X against en_X directly for every category X present
      // in BOTH locales (e.g. "one" and "other" — the categories every
      // locale is required to define), catching a mismatch on that exact
      // key pair regardless of what other categories contain.
      const heCategories = index.he.get(base)!.categories
      const enCategories = index.en.get(base)!.categories
      const overlapCategories = [...heCategories].filter((category) => enCategories.has(category)).sort()

      for (const category of overlapCategories) {
        const heKey = `${base}_${category}`
        const enKey = `${base}_${category}`
        const heValue = valueAt(he, heKey)
        const enValue = valueAt(en, enKey)
        if (typeof heValue !== 'string' || typeof enValue !== 'string') {
          continue // non-string leaf already reported by the loop below
        }
        const heP = sortedUnique(placeholders(heValue))
        const enP = sortedUnique(placeholders(enValue))
        if (heP.join(',') !== enP.join(',')) {
          errors.push(
            `"${heKey}" (he) vs "${enKey}" (en) use different interpolation placeholders: he [${heP}] vs en [${enP}]`,
          )
        }
      }

      // Rule 9 — locale-specific plural forms (a category one locale
      // defines that the other does not, e.g. Hebrew's "two"/"many") have
      // no cross-locale counterpart for Rule 8 to compare against. They
      // are instead checked against the REQUIRED placeholder set for this
      // base — the placeholders present in every overlapping category on
      // BOTH sides (derived from the data itself, not hardcoded) — so a
      // placeholder dropped from a Hebrew-only variant is still caught
      // even though English has nothing to diff it against directly.
      if (overlapCategories.length > 0) {
        const overlapPlaceholderSets = overlapCategories.flatMap((category) =>
          locales
            .map((overlapLocale) => valueAt(tree[overlapLocale], `${base}_${category}`))
            .filter((value): value is string => typeof value === 'string')
            .map((value) => new Set(placeholders(value))),
        )

        const requiredPlaceholders =
          overlapPlaceholderSets.length > 0
            ? [...overlapPlaceholderSets.reduce((acc, set) => new Set([...acc].filter((p) => set.has(p))))].sort()
            : []

        for (const locale of locales) {
          for (const category of index[locale].get(base)!.categories) {
            if (overlapCategories.includes(category)) {
              continue // already checked directly by Rule 8
            }
            const rawKey = `${base}_${category}`
            const value = valueAt(tree[locale], rawKey)
            if (typeof value !== 'string') {
              continue
            }
            const present = new Set(placeholders(value))
            const missing = requiredPlaceholders.filter((placeholder) => !present.has(placeholder))
            if (missing.length > 0) {
              errors.push(
                `"${rawKey}" in ${locale} is missing required placeholder(s) [${missing.join(',')}] present in every overlapping plural category ("one"/"other") of "${base}"`,
              )
            }
          }
        }
      }
    }

    const hePlaceholders = placeholderUnion(he, index.he, base)
    const enPlaceholders = placeholderUnion(en, index.en, base)
    if (hePlaceholders.join(',') !== enPlaceholders.join(',')) {
      errors.push(
        `"${base}" uses different interpolation placeholders: he [${hePlaceholders}] vs en [${enPlaceholders}]`,
      )
    }
  }

  for (const locale of locales) {
    for (const [rawKey, value] of flatten(tree[locale])) {
      if (typeof value !== 'string') {
        errors.push(`"${rawKey}" is not a string in ${locale}`)
      } else if (value.trim() === '') {
        errors.push(`"${rawKey}" is empty in ${locale}`)
      }
    }
  }

  return errors
}

const HE = catalogHe as unknown as LocaleTree
const EN = catalogEn as unknown as LocaleTree

function clone(tree: LocaleTree): LocaleTree {
  return structuredClone(tree)
}

function removeKey(tree: LocaleTree, path: string): LocaleTree {
  const segments = path.split('.')
  const leaf = segments.pop()!
  const parent = segments.reduce<LocaleTree>((node, key) => node[key] as LocaleTree, tree)
  delete parent[leaf]
  return tree
}

function setKey(tree: LocaleTree, path: string, value: string): LocaleTree {
  const segments = path.split('.')
  const leaf = segments.pop()!
  const parent = segments.reduce<LocaleTree>((node, key) => node[key] as LocaleTree, tree)
  parent[leaf] = value
  return tree
}

const REQUIRED_CATALOG_PAGE_KEYS = [
  'catalogPage.loading',
  'catalogPage.error',
  'catalogPage.retry',
  'catalogPage.invalidCategoryHeading',
  'catalogPage.invalidCategoryMessage',
  'catalogPage.backToAll',
  'catalogPage.catalogEmptyHeading',
  'catalogPage.catalogEmptyMessage',
  'catalogPage.filteredEmptyHeading',
  'catalogPage.emptyCategoryMessage',
]

describe('catalog namespace — the shipped locale pair', () => {
  it('satisfies every rule', () => {
    expect(validateNamespacePair(HE, EN)).toEqual([])
  })

  it('defines keys at all', () => {
    expect(flatten(HE).length).toBeGreaterThan(0)
    expect(flatten(EN).length).toBeGreaterThan(0)
  })

  it.each(REQUIRED_CATALOG_PAGE_KEYS)('defines the required catalogue-state key "%s" in both locales, non-empty', (path) => {
    const heValue = valueAt(HE, path)
    const enValue = valueAt(EN, path)
    expect(typeof heValue).toBe('string')
    expect(typeof enValue).toBe('string')
    expect((heValue as string).trim()).not.toBe('')
    expect((enValue as string).trim()).not.toBe('')
  })

  it('keeps emptyCategoryMessage under its existing name — not renamed to filteredEmptyMessage (Checkpoint B decision)', () => {
    expect(valueAt(HE, 'catalogPage.emptyCategoryMessage')).toBeTypeOf('string')
    expect(valueAt(EN, 'catalogPage.emptyCategoryMessage')).toBeTypeOf('string')
    expect(valueAt(HE, 'catalogPage.filteredEmptyMessage')).toBeUndefined()
    expect(valueAt(EN, 'catalogPage.filteredEmptyMessage')).toBeUndefined()
  })

  it('carries the {{category}} placeholder on emptyCategoryMessage in both locales', () => {
    const he = valueAt(HE, 'catalogPage.emptyCategoryMessage') as string
    const en = valueAt(EN, 'catalogPage.emptyCategoryMessage') as string
    expect(placeholders(he)).toEqual(['category'])
    expect(placeholders(en)).toEqual(['category'])
  })

  it('does not define out-of-scope search/filter or catalogue-disclosure keys (Checkpoint B §5)', () => {
    const outOfScope = [
      'catalogPage.clearSearch',
      'catalogPage.clearFilters',
      'catalogPage.demoNotice',
      'catalogPage.academicNotice',
    ]
    for (const path of outOfScope) {
      expect(valueAt(HE, path)).toBeUndefined()
      expect(valueAt(EN, path)).toBeUndefined()
    }
  })

  it('requires exactly the four Hebrew and two English plural categories for addedToCart', () => {
    const he = indexKeys(HE).get('addedToCart')!
    const en = indexKeys(EN).get('addedToCart')!

    expect([...he.categories].sort()).toEqual(['many', 'one', 'other', 'two'])
    expect([...en.categories].sort()).toEqual(['one', 'other'])
    expect(he.hasBareKey).toBe(false)
    expect(en.hasBareKey).toBe(false)
  })
})

describe('catalog namespace — the validator fails on a broken pair', () => {
  it('rejects a base key missing entirely from one locale', () => {
    expect(validateNamespacePair(removeKey(clone(HE), 'catalogPage.catalogEmptyHeading'), EN).join('\n')).toContain(
      'base key "catalogPage.catalogEmptyHeading" is missing in: he',
    )
    expect(validateNamespacePair(HE, removeKey(clone(EN), 'catalogPage.filteredEmptyHeading')).join('\n')).toContain(
      'base key "catalogPage.filteredEmptyHeading" is missing in: en',
    )
  })

  it('rejects an empty translation on either side', () => {
    expect(validateNamespacePair(setKey(clone(HE), 'catalogPage.catalogEmptyMessage', '   '), EN).join('\n')).toContain(
      '"catalogPage.catalogEmptyMessage" is empty in he',
    )
    expect(validateNamespacePair(HE, setKey(clone(EN), 'catalogPage.error', '')).join('\n')).toContain(
      '"catalogPage.error" is empty in en',
    )
  })

  it('rejects a dropped {{category}} placeholder on emptyCategoryMessage', () => {
    const he = setKey(clone(HE), 'catalogPage.emptyCategoryMessage', 'אין מוצרים בקטגוריה הזו כרגע.')

    expect(validateNamespacePair(he, EN).join('\n')).toContain(
      '"catalogPage.emptyCategoryMessage" uses different interpolation placeholders',
    )
  })

  it('rejects an added, unmatched placeholder on a non-plural key', () => {
    const en = setKey(clone(EN), 'catalogPage.catalogEmptyHeading', 'No products for {{category}}')

    expect(validateNamespacePair(HE, en).join('\n')).toContain(
      '"catalogPage.catalogEmptyHeading" uses different interpolation placeholders',
    )
  })

  it.each(['one', 'two', 'many', 'other'])('rejects Hebrew missing addedToCart_%s', (category) => {
    const errors = validateNamespacePair(removeKey(clone(HE), `addedToCart_${category}`), EN)

    expect(errors.join('\n')).toContain(`missing "_${category}" in he`)
  })

  it.each(['one', 'other'])('rejects English missing addedToCart_%s', (category) => {
    const errors = validateNamespacePair(HE, removeKey(clone(EN), `addedToCart_${category}`))

    expect(errors.join('\n')).toContain(`missing "_${category}" in en`)
  })

  it('rejects a plural category Hebrew never resolves', () => {
    const he = setKey(clone(HE), 'addedToCart_few', '{{product}} נוסף לעגלה.')
    const errors = validateNamespacePair(he, EN)

    expect(errors).toEqual(['"addedToCart" has unexpected "_few" category in he'])
  })

  // 🔴 Rule 8/9 mutation coverage — proves the placeholder check is no
  // longer union-based only. Before this fix, dropping {{product}} from
  // ONE plural variant while every other variant in the same locale
  // still carried it was invisible, because the old check only compared
  // the UNION of placeholders per locale — the union stayed {product,
  // count} either way. These tests fail on the union-only implementation
  // and pass on the corrected one.
  it('rejects {{product}} dropped from a Hebrew-only plural variant (addedToCart_two) even though addedToCart_many still has it', () => {
    const he = setKey(clone(HE), 'addedToCart_two', 'נוסף לעגלה. בעגלה שני פריטים.')
    const errors = validateNamespacePair(he, EN)

    // The union-based Rule 7 check would NOT fire here (he's union across
    // one/many/other still contains "product"), so this specific message
    // proves the NEW rule, naming the exact affected key.
    expect(errors).toContain(
      '"addedToCart_two" in he is missing required placeholder(s) [product] present in every overlapping plural category ("one"/"other") of "addedToCart"',
    )
  })

  it('rejects {{product}} dropped from addedToCart_many (Hebrew-only) even though addedToCart_two still has it', () => {
    const he = setKey(clone(HE), 'addedToCart_many', 'בעגלה {{count}} פריטים.')
    const errors = validateNamespacePair(he, EN)

    expect(errors).toContain(
      '"addedToCart_many" in he is missing required placeholder(s) [product] present in every overlapping plural category ("one"/"other") of "addedToCart"',
    )
  })

  it('rejects {{product}} dropped from an overlapping category (addedToCart_other, Hebrew side) via the direct he/en key comparison', () => {
    const he = setKey(clone(HE), 'addedToCart_other', 'בעגלה {{count}} פריטים.')
    const errors = validateNamespacePair(he, EN)

    expect(errors).toContain(
      '"addedToCart_other" (he) vs "addedToCart_other" (en) use different interpolation placeholders: he [count] vs en [count,product]',
    )
  })

  it('rejects {{product}} dropped from the English side (addedToCart_one) via the direct he/en key comparison', () => {
    const en = setKey(clone(EN), 'addedToCart_one', 'Added to cart. 1 item in cart.')
    const errors = validateNamespacePair(HE, en)

    expect(errors).toContain(
      '"addedToCart_one" (he) vs "addedToCart_one" (en) use different interpolation placeholders: he [product] vs en []',
    )
  })

  it('still accepts addedToCart_one/addedToCart_two legitimately omitting {{count}} on both sides (existing placeholder-parity behavior preserved)', () => {
    // "one" and "two" both hardcode the number in text ("1 item"/"שני
    // פריטים") rather than interpolating {{count}} — this is the same
    // legitimate per-category variation cart.i18n.test.ts documents, and
    // must NOT be flagged by either the old union check or the new
    // per-category/required checks.
    expect(validateNamespacePair(HE, EN)).toEqual([])
  })

  it('rejects a non-string leaf', () => {
    const he = clone(HE)
    ;(he.catalogPage as LocaleTree).error = 42 as unknown as string
    const errors = validateNamespacePair(he, EN).join('\n')

    expect(errors).toContain('non-plural key "catalogPage.error" is not a string in he')
    expect(errors).toContain('"catalogPage.error" is not a string in he')
  })

  it('rejects an unexpected catalogue key present only on one side', () => {
    const en = clone(EN)
    ;(en.catalogPage as LocaleTree).unexpectedKey = 'Should not exist'

    expect(validateNamespacePair(HE, en).join('\n')).toContain(
      'base key "catalogPage.unexpectedKey" is missing in: he',
    )
  })
})
