import { describe, expect, it } from 'vitest'
import cartHe from './he/cart.json'
import cartEn from './en/cart.json'

/**
 * Namespace-integrity test for `cart` — UI_IMPLEMENTATION_PLAN.md §13, tier 1:
 * "i18n key symmetry between he and en — catches the classic drift".
 *
 * Pure JSON validation. No renderer, no i18next instance, no jsdom.
 *
 * 🔴 The validator is a pure function over two locale trees, and it is proven
 * by MUTATION: each rule below has a test that clones the real locale, breaks
 * exactly one thing, and asserts the validator reports it. A test that only
 * asserts today's (correct) JSON proves the data, not the contract — the
 * previous version of this file did exactly that and was rejected in review.
 *
 * The clones are `structuredClone`d per test, so the imported production
 * objects are never mutated and no test can leak into another.
 *
 * The rules:
 *   1. Both locales define the same set of BASE keys.
 *   2. Both locales agree on whether each base key is pluralised.
 *   3. A non-plural key must exist under its exact raw key in BOTH locales —
 *      a suffixed form in one locale never satisfies a non-plural key in the
 *      other.
 *   4. A pluralised base must carry every plural category its own language
 *      requires (Hebrew one/two/many/other, English one/other), `other`
 *      included.
 *   5. A base must not mix a bare key and suffixed keys in the same locale.
 *   6. No value is empty.
 *   7. Interpolation placeholders match — per exact key for a non-plural key,
 *      per base (union across categories) for a pluralised one.
 */

type LocaleTree = { [key: string]: string | LocaleTree }
type LocaleCode = 'he' | 'en'

/**
 * The CLDR plural categories each language actually resolves. Hebrew has four,
 * English two — which is exactly why a naive key-set equality check cannot be
 * used here: it would forbid correct Hebrew.
 *
 * 🔴 This is an EXACT set, not a lower bound: a pluralised base must carry
 * every category listed for its locale and no others. A category the language
 * never resolves (`page.summary_few` in either locale here) is dead
 * translation that will never be shown, so it is reported rather than
 * tolerated or normalised away.
 */
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

/** Every raw key belonging to a base, bare form included. */
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

/**
 * Returns every contract violation as a message. An empty array means the
 * namespace pair is sound.
 */
export function validateNamespacePair(he: LocaleTree, en: LocaleTree): string[] {
  const errors: string[] = []
  const index: Record<LocaleCode, KeyIndex> = { he: indexKeys(he), en: indexKeys(en) }
  const tree: Record<LocaleCode, LocaleTree> = { he, en }
  const locales: LocaleCode[] = ['he', 'en']

  const allBases = sortedUnique([...index.he.keys(), ...index.en.keys()])

  for (const base of allBases) {
    // Rule 1 — the base key exists on both sides.
    const missingIn = locales.filter((locale) => !index[locale].has(base))
    if (missingIn.length > 0) {
      errors.push(`base key "${base}" is missing in: ${missingIn.join(', ')}`)
      continue
    }

    // Rule 5 — never a bare key and suffixed keys for the same base.
    for (const locale of locales) {
      const entry = index[locale].get(base)!
      if (entry.hasBareKey && entry.categories.size > 0) {
        errors.push(`"${base}" mixes a bare key with plural categories in ${locale}`)
      }
    }

    // Rule 2 — both locales agree on whether the base is pluralised. This is
    // what stops a non-plural key in one locale from being "satisfied" by a
    // suffixed form in the other (rule 3).
    const pluralIn = locales.filter((locale) => isPluralised(index[locale], base))
    if (pluralIn.length === 1) {
      const nonPlural = locales.find((locale) => !pluralIn.includes(locale))
      errors.push(`"${base}" is pluralised in ${pluralIn[0]} but not in ${nonPlural}`)
      continue
    }

    if (pluralIn.length === 0) {
      // Rule 3 — a non-plural key must resolve at its exact raw path.
      for (const locale of locales) {
        if (typeof valueAt(tree[locale], base) !== 'string') {
          errors.push(`non-plural key "${base}" is not a string in ${locale}`)
        }
      }
    } else {
      // Rule 4 — exactly the categories the language resolves, `other` included.
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
        // Sorted, so the message order is deterministic regardless of key order.
        for (const category of [...present].sort()) {
          if (!allowed.has(category)) {
            errors.push(`"${base}" has unexpected "_${category}" category in ${locale}`)
          }
        }
      }
    }

    // Rule 7 — placeholder compatibility, per base (a non-plural base has
    // exactly one raw key, so the union is that key's own placeholders).
    const hePlaceholders = placeholderUnion(he, index.he, base)
    const enPlaceholders = placeholderUnion(en, index.en, base)
    if (hePlaceholders.join(',') !== enPlaceholders.join(',')) {
      errors.push(
        `"${base}" uses different interpolation placeholders: he [${hePlaceholders}] vs en [${enPlaceholders}]`,
      )
    }
  }

  // Rule 6 — no empty value anywhere, in either locale.
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

const HE = cartHe as unknown as LocaleTree
const EN = cartEn as unknown as LocaleTree

/** A fresh clone per mutation, so the imported production objects stay intact. */
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

function renameKey(tree: LocaleTree, path: string, newLeaf: string): LocaleTree {
  const segments = path.split('.')
  const leaf = segments.pop()!
  const parent = segments.reduce<LocaleTree>((node, key) => node[key] as LocaleTree, tree)
  parent[newLeaf] = parent[leaf]
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

describe('cart namespace — the shipped locale pair', () => {
  it('satisfies every rule', () => {
    expect(validateNamespacePair(HE, EN)).toEqual([])
  })

  it('defines keys at all', () => {
    expect(flatten(HE).length).toBeGreaterThan(0)
    expect(flatten(EN).length).toBeGreaterThan(0)
  })

  it('requires exactly the four Hebrew and two English plural categories for page.summary', () => {
    const he = indexKeys(HE).get('page.summary')!
    const en = indexKeys(EN).get('page.summary')!

    expect([...he.categories].sort()).toEqual(['many', 'one', 'other', 'two'])
    expect([...en.categories].sort()).toEqual(['one', 'other'])
    expect(he.hasBareKey).toBe(false)
    expect(en.hasBareKey).toBe(false)
  })
})

describe('cart namespace — the validator fails on a broken pair', () => {
  it.each(['one', 'two', 'many', 'other'])('rejects Hebrew missing page.summary_%s', (category) => {
    const errors = validateNamespacePair(removeKey(clone(HE), `page.summary_${category}`), EN)

    expect(errors.join('\n')).toContain(`missing "_${category}" in he`)
  })

  it.each(['one', 'other'])('rejects English missing page.summary_%s', (category) => {
    const errors = validateNamespacePair(HE, removeKey(clone(EN), `page.summary_${category}`))

    expect(errors.join('\n')).toContain(`missing "_${category}" in en`)
  })

  it('rejects a non-plural key replaced by a suffixed variant', () => {
    // `remove.label` is not a plural key. Renaming it to `remove.label_other`
    // must not be accepted as satisfying it.
    const errors = validateNamespacePair(renameKey(clone(HE), 'remove.label', 'label_other'), EN)

    expect(errors.join('\n')).toContain('"remove.label" is pluralised in he but not in en')
  })

  it('rejects one locale pluralising a base the other leaves non-plural', () => {
    const en = clone(EN)
    renameKey(en, 'page.title', 'title_other')
    setKey(en, 'page.title_one', 'Shopping cart')

    expect(validateNamespacePair(HE, en).join('\n')).toContain('"page.title" is pluralised in en but not in he')
  })

  it('rejects a base key missing entirely from one locale', () => {
    expect(validateNamespacePair(removeKey(clone(HE), 'remove.label'), EN).join('\n')).toContain(
      'base key "remove.label" is missing in: he',
    )
    expect(validateNamespacePair(HE, removeKey(clone(EN), 'empty.heading')).join('\n')).toContain(
      'base key "empty.heading" is missing in: en',
    )
  })

  it('rejects a base that mixes a bare key with plural categories', () => {
    const he = setKey(clone(HE), 'page.summary', 'פריטים בעגלה')

    expect(validateNamespacePair(he, EN).join('\n')).toContain(
      '"page.summary" mixes a bare key with plural categories in he',
    )
  })

  it('rejects a plural category Hebrew never resolves', () => {
    // `_few` is not a Hebrew CLDR category — dead translation that would never
    // be shown. Every required category is still present, so this must be the
    // ONLY violation reported: that is what proves the new rule fired rather
    // than some unrelated check.
    const he = setKey(clone(HE), 'page.summary_few', '{{count}} פריטים בעגלה')
    const errors = validateNamespacePair(he, EN)

    expect(errors).toEqual(['"page.summary" has unexpected "_few" category in he'])
  })

  it('rejects a plural category English never resolves', () => {
    const en = setKey(clone(EN), 'page.summary_few', '{{count}} items in cart')
    const errors = validateNamespacePair(HE, en)

    expect(errors).toEqual(['"page.summary" has unexpected "_few" category in en'])
  })

  it('rejects an unexpected category even when a required one is also missing', () => {
    // Both rules must report independently — the unexpected-category check is
    // not short-circuited by an earlier failure.
    const he = clone(HE)
    setKey(he, 'page.summary_few', '{{count}} פריטים בעגלה')
    removeKey(he, 'page.summary_two')
    const errors = validateNamespacePair(he, EN).join('\n')

    expect(errors).toContain('missing "_two" in he')
    expect(errors).toContain('"page.summary" has unexpected "_few" category in he')
  })

  it('rejects a non-string leaf', () => {
    const he = clone(HE)
    // A number where a translation belongs — the branch that guards against a
    // structurally wrong locale file, not merely a missing one.
    ;(he.remove as LocaleTree).label = 42 as unknown as string
    const errors = validateNamespacePair(he, EN).join('\n')

    expect(errors).toContain('non-plural key "remove.label" is not a string in he')
    expect(errors).toContain('"remove.label" is not a string in he')
  })

  it('rejects an empty translation on either side', () => {
    expect(validateNamespacePair(setKey(clone(HE), 'remove.label', '   '), EN).join('\n')).toContain(
      '"remove.label" is empty in he',
    )
    expect(validateNamespacePair(HE, setKey(clone(EN), 'empty.message', '')).join('\n')).toContain(
      '"empty.message" is empty in en',
    )
  })

  it('rejects a dropped interpolation placeholder on a non-plural key', () => {
    const he = setKey(clone(HE), 'remove.ariaLabel', 'הסרה מהעגלה')

    expect(validateNamespacePair(he, EN).join('\n')).toContain('different interpolation placeholders')
  })

  it('rejects a dropped interpolation placeholder across every plural category', () => {
    const he = clone(HE)
    setKey(he, 'page.summary_many', 'פריטים בעגלה')
    setKey(he, 'page.summary_other', 'פריטים בעגלה')

    // `count` now appears in no Hebrew category, while English still uses it.
    expect(validateNamespacePair(he, EN).join('\n')).toContain('different interpolation placeholders')
  })

  it('still accepts a placeholder that legitimately appears in only some plural categories', () => {
    // "פריט אחד בעגלה" / "1 item in cart" carry no {{count}} by design; the
    // union across categories is what must match, not each category.
    expect(validateNamespacePair(HE, EN)).toEqual([])
    expect(placeholderUnion(HE, indexKeys(HE), 'page.summary')).toEqual(['count'])
    expect(placeholderUnion(EN, indexKeys(EN), 'page.summary')).toEqual(['count'])
  })
})
