/**
 * Shared locale-integrity validator — the current verified 9-rule contract.
 *
 * Consolidates `cart.i18n.test.ts` (previously 7 rules) and
 * `catalog.i18n.test.ts` (previously an independent 9-rule reimplementation,
 * self-contained because importing another `*.test.ts` file would re-execute
 * its `describe` blocks) onto ONE module, at the stronger 9-rule target.
 *
 * Pure JSON validation. No renderer, no i18next instance, no jsdom.
 * Test-only: nothing under `client/src` outside `client/src/locales/*.test.ts`
 * imports this module, and it carries no runtime/app dependency.
 *
 * The rules:
 *   1. Both locales define the same set of BASE keys.
 *   2. Both locales agree on whether each base key is pluralised.
 *   3. A non-plural key must exist at its exact raw path in BOTH locales —
 *      a suffixed form in one locale never satisfies a non-plural key in the
 *      other.
 *   4. A pluralised base must carry every plural category its own language
 *      requires (Hebrew one/two/many/other, English one/other), `other`
 *      included, and no category its language never resolves.
 *   5. A base must not mix a bare key and suffixed keys in the same locale.
 *   6. No value is empty, and every leaf must be a string.
 *   7. Interpolation placeholders match per base — the UNION of placeholders
 *      across all of a base's plural categories, compared between locales.
 *   8. Interpolation placeholders match PER CORRESPONDING CATEGORY, for every
 *      category present in BOTH locales (e.g. "one"/"other") — Rule 7's
 *      union comparison cannot see a placeholder dropped from one specific
 *      category while another category in the same locale still carries it.
 *   9. A category only one locale defines (e.g. Hebrew's "two"/"many") has no
 *      cross-locale counterpart for Rule 8 to compare against, so it is
 *      checked against the REQUIRED placeholder set for its base — derived
 *      from the placeholders present in every overlapping category on BOTH
 *      sides — catching a placeholder dropped from a locale-only variant
 *      even though the other locale has nothing to diff it against directly.
 *
 * 🔴 No rule is dropped, weakened, merged or renamed. Independent violation
 * accumulation, both load-bearing `continue`s, deterministic sorted
 * iteration/diagnostics, and Rule 7 alongside 8 and 9 are all preserved
 * exactly as they existed in `catalog.i18n.test.ts` at Slice 10 Checkpoint A.
 */

export type LocaleTree = { [key: string]: string | LocaleTree }
export type LocaleCode = 'he' | 'en'

/**
 * The CLDR plural categories each language actually resolves. Hebrew has
 * four, English two — which is exactly why a naive key-set equality check
 * cannot be used here: it would forbid correct Hebrew.
 *
 * 🔴 This is an EXACT set, not a lower bound: a pluralised base must carry
 * every category listed for its locale and no others. A category the
 * language never resolves is dead translation that will never be shown, so
 * it is reported rather than tolerated or normalised away.
 */
export const REQUIRED_PLURAL_CATEGORIES: Record<LocaleCode, readonly string[]> = {
  he: ['one', 'two', 'many', 'other'],
  en: ['one', 'other'],
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

export type KeyIndex = Map<string, { categories: Set<string>; hasBareKey: boolean }>

export function flatten(node: unknown, prefix = ''): [string, unknown][] {
  if (typeof node !== 'object' || node === null) {
    return [[prefix, node]]
  }

  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  )
}

export function splitKey(rawKey: string): { base: string; category: string | null } {
  const match = PLURAL_SUFFIX.exec(rawKey)
  return match ? { base: rawKey.slice(0, match.index), category: match[1] } : { base: rawKey, category: null }
}

export function indexKeys(tree: LocaleTree): KeyIndex {
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

export function isPluralised(index: KeyIndex, base: string): boolean {
  return (index.get(base)?.categories.size ?? 0) > 0
}

export function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1])
}

export function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

/** Every raw key belonging to a base, bare form included. */
export function rawKeysFor(index: KeyIndex, base: string): string[] {
  const entry = index.get(base)
  if (!entry) {
    return []
  }
  return [...(entry.hasBareKey ? [base] : []), ...[...entry.categories].map((category) => `${base}_${category}`)]
}

export function valueAt(tree: LocaleTree, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (typeof node !== 'object' || node === null) {
      return undefined
    }
    return (node as Record<string, unknown>)[key]
  }, tree)
}

export function placeholderUnion(tree: LocaleTree, index: KeyIndex, base: string): string[] {
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
          // Sorted, so diagnostic order is deterministic regardless of the
          // source locale JSON's key insertion order (Set iteration order
          // otherwise follows insertion order).
          for (const category of [...index[locale].get(base)!.categories].sort()) {
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
