import { describe, expect, it } from 'vitest'
import cartHe from './he/cart.json'
import cartEn from './en/cart.json'
import catalogHe from './he/catalog.json'
import catalogEn from './en/catalog.json'
import {
  flatten,
  indexKeys,
  placeholderUnion,
  placeholders,
  validateNamespacePair,
  type LocaleTree,
} from './localeIntegrity'

/**
 * Contract-level mutation proofs for `localeIntegrity.ts`'s shared 9-rule
 * validator — Slice 10 Checkpoint B.
 *
 * These proofs use a SYNTHETIC locale pair, not the real `cart`/`catalog`
 * data, so they exercise the validator's CONTRACT independent of any one
 * namespace's shipped copy. `cart.i18n.test.ts` and `catalog.i18n.test.ts`
 * shrink to "the real shipped pair reports zero violations" plus their own
 * namespace-specific assertions (required keys, specific plural shapes,
 * specific placeholder contracts) — the generic mutation proofs that used
 * to live in each of those files, proven against their real keys as a
 * vehicle, now live here, proven against a fixture built for exactly this
 * purpose.
 *
 * 🔴 Every rule below is proven by MUTATION: clone the fixture, break
 * exactly one thing, assert the validator reports it. A test that only
 * asserts today's (correct) fixture proves the fixture, not the contract.
 */

/**
 * Deliberately exercises: a non-plural base ("greeting", carries
 * `{{name}}`) and a pluralised base ("itemCount", he: one/two/other,
 * en: one/other, all with `{{count}}` present on every category on both
 * sides) — the minimum shape needed to prove all 9 rules independently.
 *
 * ⚠️ ISSUE-099: `many` was removed from the Hebrew side of this fixture
 * together with the REQUIRED_PLURAL_CATEGORIES row — Hebrew never resolves
 * it (Intl.PluralRules('he') yields one/two/other), so the fixture carried
 * a category the validator now correctly rejects.
 */
function baseFixture(): { he: LocaleTree; en: LocaleTree } {
  return {
    he: {
      greeting: 'שלום {{name}}',
      itemCount_one: '{{count}} פריט',
      itemCount_two: '{{count}} פריטים',
      itemCount_other: '{{count}} פריטים',
    },
    en: {
      greeting: 'Hello {{name}}',
      itemCount_one: '{{count}} item',
      itemCount_other: '{{count}} items',
    },
  }
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

describe('localeIntegrity — the fixture itself is sound', () => {
  it('reports zero violations on the unmodified fixture', () => {
    const { he, en } = baseFixture()
    expect(validateNamespacePair(he, en)).toEqual([])
  })

  it('exercises flatten/indexKeys/placeholders/placeholderUnion the way namespace suites need', () => {
    const { he } = baseFixture()
    expect(flatten(he).length).toBeGreaterThan(0)
    const index = indexKeys(he)
    expect([...index.get('itemCount')!.categories].sort()).toEqual(['one', 'other', 'two'])
    expect(placeholders('{{count}} x')).toEqual(['count'])
    expect(placeholderUnion(he, index, 'itemCount')).toEqual(['count'])
  })
})

describe('localeIntegrity — Rule 1 (base key parity)', () => {
  it('rejects a base key missing entirely from Hebrew', () => {
    const { he, en } = baseFixture()
    expect(validateNamespacePair(removeKey(he, 'greeting'), en).join('\n')).toContain(
      'base key "greeting" is missing in: he',
    )
  })

  it('rejects a base key missing entirely from English', () => {
    const { he, en } = baseFixture()
    expect(validateNamespacePair(he, removeKey(en, 'greeting')).join('\n')).toContain(
      'base key "greeting" is missing in: en',
    )
  })
})

describe('localeIntegrity — Rule 2 (pluralisation agreement) and Rule 3 (non-plural exact path)', () => {
  it('rejects a non-plural key replaced by a single suffixed variant (distinct from the fully-populated case below)', () => {
    // A bare non-plural key renamed to JUST "_other" — no other category
    // added. Distinct from the test below: that one populates every
    // required category so the plural side is contract-complete; this one
    // proves Rule 2 fires even on a minimally/incorrectly suffixed rename.
    const { he, en } = baseFixture()
    renameKey(he, 'greeting', 'greeting_other')

    expect(validateNamespacePair(he, en).join('\n')).toContain('"greeting" is pluralised in he but not in en')
  })

  it('rejects one locale pluralising a base the other leaves non-plural (fully-populated plural side)', () => {
    const { he, en } = baseFixture()
    renameKey(en, 'greeting', 'greeting_other')
    setKey(en, 'greeting_one', 'Hi {{name}}')

    expect(validateNamespacePair(he, en).join('\n')).toContain('"greeting" is pluralised in en but not in he')
  })

  it('rejects a non-string leaf at a non-plural key (Rule 3 alongside Rule 6)', () => {
    const { he, en } = baseFixture()
    ;(he as Record<string, unknown>).greeting = 42

    const errors = validateNamespacePair(he, en).join('\n')
    expect(errors).toContain('non-plural key "greeting" is not a string in he')
    expect(errors).toContain('"greeting" is not a string in he')
  })
})

describe('localeIntegrity — Rule 4 (exact required plural categories)', () => {
  it.each(['one', 'two', 'other'])('rejects Hebrew missing itemCount_%s', (category) => {
    const { he, en } = baseFixture()
    expect(validateNamespacePair(removeKey(he, `itemCount_${category}`), en).join('\n')).toContain(
      `missing "_${category}" in he`,
    )
  })

  it.each(['one', 'other'])('rejects English missing itemCount_%s', (category) => {
    const { he, en } = baseFixture()
    expect(validateNamespacePair(he, removeKey(en, `itemCount_${category}`)).join('\n')).toContain(
      `missing "_${category}" in en`,
    )
  })

  it('rejects a plural category Hebrew never resolves (exact-array diagnostic)', () => {
    const { he, en } = baseFixture()
    setKey(he, 'itemCount_few', '{{count}} מס')

    expect(validateNamespacePair(he, en)).toEqual(['"itemCount" has unexpected "_few" category in he'])
  })

  it('🔴 ISSUE-099 — rejects "_many" in Hebrew, the category the table itself used to demand', () => {
    // CLDR dropped Hebrew's `many`; Intl.PluralRules('he') resolves only
    // one/two/other, so a `_many` string is dead translation. The old table
    // MANDATED it — this is the regression test on the corrected row.
    const { he, en } = baseFixture()
    setKey(he, 'itemCount_many', '{{count}} פריטים')

    expect(validateNamespacePair(he, en)).toEqual(['"itemCount" has unexpected "_many" category in he'])
  })

  it('rejects a plural category English never resolves (exact-array diagnostic)', () => {
    const { he, en } = baseFixture()
    setKey(en, 'itemCount_few', '{{count}} items (few)')

    expect(validateNamespacePair(he, en)).toEqual(['"itemCount" has unexpected "_few" category in en'])
  })

  it('rejects an unexpected category even when a required one is also missing (independent accumulation)', () => {
    const { he, en } = baseFixture()
    setKey(he, 'itemCount_few', '{{count}} מס')
    removeKey(he, 'itemCount_two')

    const errors = validateNamespacePair(he, en).join('\n')
    expect(errors).toContain('missing "_two" in he')
    expect(errors).toContain('"itemCount" has unexpected "_few" category in he')
  })
})

describe('localeIntegrity — Rule 5 (no bare key mixed with suffixed keys)', () => {
  it('rejects a base that mixes a bare key with plural categories', () => {
    const { he, en } = baseFixture()
    setKey(he, 'itemCount', 'פריטים בעגלה')

    expect(validateNamespacePair(he, en).join('\n')).toContain(
      '"itemCount" mixes a bare key with plural categories in he',
    )
  })
})

describe('localeIntegrity — Rule 6 (no empty / non-string values)', () => {
  it('rejects an empty translation in Hebrew', () => {
    const { he, en } = baseFixture()
    expect(validateNamespacePair(setKey(he, 'greeting', '   '), en).join('\n')).toContain(
      '"greeting" is empty in he',
    )
  })

  it('rejects an empty translation in English', () => {
    const { he, en } = baseFixture()
    expect(validateNamespacePair(he, setKey(en, 'greeting', '')).join('\n')).toContain('"greeting" is empty in en')
  })
})

describe('localeIntegrity — Rule 7 (union placeholder parity per base)', () => {
  it('rejects a dropped interpolation placeholder on a non-plural key', () => {
    const { he, en } = baseFixture()
    setKey(en, 'greeting', 'Hello')

    expect(validateNamespacePair(he, en).join('\n')).toContain('different interpolation placeholders')
  })

  it('rejects an added, unmatched placeholder on a non-plural key (the opposite direction)', () => {
    const { he, en } = baseFixture()
    setKey(en, 'greeting', 'Hello {{name}} {{extra}}')

    expect(validateNamespacePair(he, en).join('\n')).toContain(
      '"greeting" uses different interpolation placeholders',
    )
  })

  it('rejects a placeholder dropped across EVERY plural category of a pluralised base (union-level mismatch)', () => {
    const { he, en } = baseFixture()
    // Drop {{count}} from ALL THREE Hebrew categories — he's union becomes
    // empty of "count" while en's union (via itemCount_other) still has it.
    // Distinct from the per-category Rule 8/9 proofs below: this exercises
    // Rule 7's UNION check on a pluralised base, not a single category.
    setKey(he, 'itemCount_one', 'פריט אחד')
    setKey(he, 'itemCount_two', 'שני פריטים')
    setKey(he, 'itemCount_other', 'פריטים')

    const errors = validateNamespacePair(he, en)
    expect(errors).toContain('"itemCount" uses different interpolation placeholders: he [] vs en [count]')
  })

})

/**
 * A SEPARATE fixture from `baseFixture()`, built to genuinely exercise
 * legitimate per-category placeholder omission — mirroring the real shipped
 * `cart.json` `page.summary` shape (both locales hardcode the number in
 * "one", e.g. "פריט אחד"/"1 item", carrying NO `{{count}}`, while every
 * other category does). `baseFixture()` cannot stand in for this: it
 * carries `{{count}}` on every category on both sides, so its "unmodified
 * fixture passes" assertion proved nothing was ever actually omitted.
 */
function legitimateOmissionFixture(): { he: LocaleTree; en: LocaleTree } {
  return {
    he: {
      itemCount_one: 'פריט אחד', // no {{count}} — hardcoded, by design
      itemCount_two: '{{count}} פריטים',
      itemCount_other: '{{count}} פריטים',
    },
    en: {
      itemCount_one: '1 item', // no {{count}} — hardcoded, by design, BOTH sides
      itemCount_other: '{{count}} items',
    },
  }
}

describe('localeIntegrity — legitimate per-category placeholder omission (Rule 8/9 must not over-demand)', () => {
  it('accepts a category that legitimately omits a placeholder on BOTH locales (overlapping category "one")', () => {
    const { he, en } = legitimateOmissionFixture()
    // "one" is an overlap category (present in both locales) and both sides
    // agree to omit {{count}} — Rule 8's direct he_one/en_one comparison
    // must see them as equal (both empty), not flag a mismatch.
    expect(validateNamespacePair(he, en)).toEqual([])
  })

  it('the derived Rule 9 required-placeholder set excludes {{count}} once an overlap category omits it — locale-only categories are NOT required to carry it', () => {
    const { he, en } = legitimateOmissionFixture()
    // Rule 9's required set is the INTERSECTION of placeholders across every
    // overlap category (here: "one" -> {} and "other" -> {count}). The
    // intersection with an empty set is empty, so the locale-only "two"
    // category is required to carry NOTHING — even though it
    // (legitimately) still carries {{count}} itself. This is the same
    // fixture as the test above; asserted again here as the Rule 9-specific
    // claim, not just Rule 8's.
    expect(validateNamespacePair(he, en)).toEqual([])
  })

  it('Rule 9 does not demand {{count}} on a locale-only category even when that category itself also omits it', () => {
    const he = legitimateOmissionFixture().he
    const en = legitimateOmissionFixture().en
    // Strengthen the omission further: itemCount_two (Hebrew-only) ALSO
    // drops {{count}}. If Rule 9 were incorrectly using a UNION of overlap
    // placeholders (or a hardcoded {count} requirement) instead of the
    // genuine intersection, this would still report nothing wrong — so this
    // alone would not distinguish a correct from an over-strict Rule 9. It
    // exists to prove the NEGATIVE space stays clean under further mutation
    // of the already-omitting fixture, not just the unmodified one.
    setKey(he, 'itemCount_two', 'שני פריטים')

    expect(validateNamespacePair(he, en)).toEqual([])
  })

  it('proves the required set is genuinely DERIVED, not merely absent: reinstating {{count}} on the overlap "one" category makes it required again on the locale-only categories', () => {
    // 🔴 This is the test that actually fails if Rule 9 is weakened to
    // "never require anything" instead of correctly deriving the required
    // set from the overlap intersection. Starting from `legitimateOmissionFixture`
    // (required set = {}, both "one" sides agree to omit {{count}}), restore
    // {{count}} to BOTH he_one and en_one — now every overlap category
    // (one, other) carries {{count}} on both sides, so the derived required
    // set becomes {count} again, and a Hebrew-only category that omits it
    // must be reported — the same Rule 9 mechanism already proven against
    // `baseFixture()` above, confirmed here to be driven by the actual
    // overlap data rather than by which fixture happens to be in use.
    const { he, en } = legitimateOmissionFixture()
    setKey(he, 'itemCount_one', '{{count}} פריט אחד')
    setKey(en, 'itemCount_one', '1 {{count}} item')
    // With both "one" sides now carrying {{count}}, the required set becomes
    // {count} again — drop it from the Hebrew-only "two" category to prove
    // Rule 9 now (correctly) demands it, where the tests above proved it
    // did NOT demand it while "one" still legitimately omitted the union.
    setKey(he, 'itemCount_two', 'שני פריטים')

    const errors = validateNamespacePair(he, en)
    expect(errors).toContain(
      '"itemCount_two" in he is missing required placeholder(s) [count] present in every overlapping plural category ("one"/"other") of "itemCount"',
    )
  })
})

describe('localeIntegrity — Rule 8 (per-corresponding-category placeholder parity)', () => {
  it('rejects {{count}} dropped from one overlapping category on the ENGLISH side (itemCount_one) even though the union still matches', () => {
    const { he, en } = baseFixture()
    // Dropping {{count}} from en's itemCount_one does NOT change en's union
    // (itemCount_other still carries {{count}}), so Rule 7 alone would miss
    // this — it must be Rule 8 that fires.
    setKey(en, 'itemCount_one', '1 item')

    const errors = validateNamespacePair(he, en)
    expect(errors).toContain(
      '"itemCount_one" (he) vs "itemCount_one" (en) use different interpolation placeholders: he [count] vs en []',
    )
    // Prove Rule 7 genuinely did not fire for this mutation — Rule 8 is
    // doing independent work, not restating Rule 7.
    expect(errors.some((message) => message.startsWith('"itemCount" uses different interpolation placeholders'))).toBe(
      false,
    )
  })

  it('rejects {{count}} dropped from one overlapping category on the HEBREW side (itemCount_other) even though the union still matches', () => {
    const { he, en } = baseFixture()
    // The mirror-image mutation of the test above, on the other overlap
    // category and the other locale — Rule 8's he_X/en_X comparison must
    // fire regardless of which side dropped the placeholder.
    setKey(he, 'itemCount_other', 'פריטים')

    const errors = validateNamespacePair(he, en)
    expect(errors).toContain(
      '"itemCount_other" (he) vs "itemCount_other" (en) use different interpolation placeholders: he [] vs en [count]',
    )
    expect(errors.some((message) => message.startsWith('"itemCount" uses different interpolation placeholders'))).toBe(
      false,
    )
  })
})

describe('localeIntegrity — Rule 9 (locale-only category checked against the overlap-derived required set)', () => {
  it('rejects {{count}} dropped from a Hebrew-only plural variant (itemCount_two)', () => {
    const { he, en } = baseFixture()
    // "two" exists only in Hebrew — Rule 8 has no English counterpart to
    // diff it against, so Rule 9 must be what catches this.
    setKey(he, 'itemCount_two', 'שני פריטים')

    const errors = validateNamespacePair(he, en)
    expect(errors).toContain(
      '"itemCount_two" in he is missing required placeholder(s) [count] present in every overlapping plural category ("one"/"other") of "itemCount"',
    )
  })

})

/*
 * ⚠️ A "Rule 9 diagnostic order is deterministic" describe lived here until
 * ISSUE-099. It proved the locale-only-category loop iterates a SORTED copy
 * of the category Set by declaring Hebrew's two locale-only categories
 * ("two" and "many") in both insertion orders and asserting byte-identical
 * diagnostics. With `many` correctly gone from Hebrew's table, Hebrew has
 * exactly ONE locale-only category and the scenario can no longer be
 * constructed from a valid fixture — no current locale pair has two
 * locale-only categories. The `.sort()` it guarded is still in Rule 9
 * (localeIntegrity.ts), alongside Rule 4's identical, still-tested one.
 */

describe('localeIntegrity — the real shipped pairs, under the full 9-rule contract', () => {
  it('cart reports zero violations', () => {
    expect(validateNamespacePair(cartHe as unknown as LocaleTree, cartEn as unknown as LocaleTree)).toEqual([])
  })

  it('catalog reports zero violations', () => {
    expect(validateNamespacePair(catalogHe as unknown as LocaleTree, catalogEn as unknown as LocaleTree)).toEqual([])
  })
})

type LocaleCode7 = 'he' | 'en'
type KeyIndex7 = Map<string, { categories: Set<string>; hasBareKey: boolean }>

const PLURAL_SUFFIX_7 = /_(zero|one|two|few|many|other)$/
// ⚠️ ISSUE-099: `many` removed from the he row here too. This copy exists to
// prove Rules 8/9 are NEW coverage, not to pin the old (wrong) plural table —
// leaving `many` would make the legacy validator demand a category the shared
// fixture no longer carries, and every comparison below would fail on Rule 4
// noise instead of the Rule 8/9 gap it demonstrates.
const REQUIRED_PLURAL_CATEGORIES_7: Record<LocaleCode7, readonly string[]> = {
  he: ['one', 'two', 'other'],
  en: ['one', 'other'],
}

function flatten7(node: unknown, prefix = ''): [string, unknown][] {
  if (typeof node !== 'object' || node === null) return [[prefix, node]]
  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) =>
    flatten7(child, prefix ? `${prefix}.${key}` : key),
  )
}

function indexKeys7(t: LocaleTree): KeyIndex7 {
  const idx: KeyIndex7 = new Map()
  for (const [rawKey] of flatten7(t)) {
    const match = PLURAL_SUFFIX_7.exec(rawKey)
    const base = match ? rawKey.slice(0, match.index) : rawKey
    const category = match ? match[1] : null
    const entry = idx.get(base) ?? { categories: new Set<string>(), hasBareKey: false }
    if (category === null) entry.hasBareKey = true
    else entry.categories.add(category)
    idx.set(base, entry)
  }
  return idx
}

function valueAt7(t: LocaleTree, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (typeof node !== 'object' || node === null) return undefined
    return (node as Record<string, unknown>)[key]
  }, t)
}

function rawKeysFor7(idx: KeyIndex7, base: string): string[] {
  const entry = idx.get(base)
  if (!entry) return []
  return [...(entry.hasBareKey ? [base] : []), ...[...entry.categories].map((c) => `${base}_${c}`)]
}

function placeholderUnion7(t: LocaleTree, idx: KeyIndex7, base: string): string[] {
  const all = rawKeysFor7(idx, base).flatMap((rawKey) => {
    const value = valueAt7(t, rawKey)
    return typeof value === 'string' ? placeholders(value) : []
  })
  return [...new Set(all)].sort()
}

/**
 * 🔴 Critical proof, B-2/B-6: Rules 8 and 9 are genuinely NEW coverage, not
 * a restatement of Rules 1–7. This is a verbatim reproduction of the
 * PRE-Checkpoint-B validator (`cart.i18n.test.ts` before this checkpoint) —
 * 7 rules, no per-category or locale-only-category placeholder check. It
 * exists ONLY inside this one proof, is never exported, and is never
 * substituted for the real module anywhere else in the suite ("restored" —
 * the shared `validateNamespacePair` above is the only validator every
 * other test in this file and in `cart.i18n.test.ts` / `catalog.i18n.test.ts`
 * actually uses).
 */
function validateNamespacePairLegacy7Rule(he: LocaleTree, en: LocaleTree): string[] {
  const errors: string[] = []
  const index: Record<LocaleCode7, KeyIndex7> = { he: indexKeys7(he), en: indexKeys7(en) }
  const tree: Record<LocaleCode7, LocaleTree> = { he, en }
  const locales: LocaleCode7[] = ['he', 'en']
  const required = REQUIRED_PLURAL_CATEGORIES_7

  const allBases = [...new Set([...index.he.keys(), ...index.en.keys()])].sort()
  for (const base of allBases) {
    const missingIn = locales.filter((l) => !index[l].has(base))
    if (missingIn.length > 0) {
      errors.push(`base key "${base}" is missing in: ${missingIn.join(', ')}`)
      continue
    }
    for (const l of locales) {
      const entry = index[l].get(base)!
      if (entry.hasBareKey && entry.categories.size > 0) {
        errors.push(`"${base}" mixes a bare key with plural categories in ${l}`)
      }
    }
    const pluralIn = locales.filter((l) => (index[l].get(base)?.categories.size ?? 0) > 0)
    if (pluralIn.length === 1) {
      const nonPlural = locales.find((l) => !pluralIn.includes(l))
      errors.push(`"${base}" is pluralised in ${pluralIn[0]} but not in ${nonPlural}`)
      continue
    }
    if (pluralIn.length === 0) {
      for (const l of locales) {
        if (typeof valueAt7(tree[l], base) !== 'string') {
          errors.push(`non-plural key "${base}" is not a string in ${l}`)
        }
      }
    } else {
      for (const l of locales) {
        const present = index[l].get(base)!.categories
        const allowed = new Set(required[l])
        for (const category of required[l]) {
          if (!present.has(category)) errors.push(`pluralised key "${base}" is missing "_${category}" in ${l}`)
        }
        if (!present.has('other')) errors.push(`pluralised key "${base}" must define "_other" in ${l}`)
        for (const category of [...present].sort()) {
          if (!allowed.has(category)) errors.push(`"${base}" has unexpected "_${category}" category in ${l}`)
        }
      }
      // No Rule 8, no Rule 9 — this is the gap Checkpoint B closes.
    }
    const heP = placeholderUnion7(he, index.he, base)
    const enP = placeholderUnion7(en, index.en, base)
    if (heP.join(',') !== enP.join(',')) {
      errors.push(`"${base}" uses different interpolation placeholders: he [${heP}] vs en [${enP}]`)
    }
  }
  for (const l of locales) {
    for (const [rawKey, value] of flatten7(tree[l])) {
      if (typeof value !== 'string') errors.push(`"${rawKey}" is not a string in ${l}`)
      else if (value.trim() === '') errors.push(`"${rawKey}" is empty in ${l}`)
    }
  }
  return errors
}

describe('localeIntegrity — Rules 8/9 are new coverage (legacy 7-rule comparison)', () => {
  it('the legacy 7-rule form misses a per-category placeholder drop that Rule 8 catches', () => {
    const { he, en } = baseFixture()
    setKey(en, 'itemCount_one', '1 item')

    const legacyErrors = validateNamespacePairLegacy7Rule(he, en)
    const currentErrors = validateNamespacePair(he, en)

    expect(legacyErrors).toEqual([]) // the gap: old validator sees nothing wrong
    expect(currentErrors.length).toBeGreaterThan(0) // the fix: new validator catches it
  })

  it('the legacy 7-rule form misses a locale-only-category placeholder drop that Rule 9 catches', () => {
    const { he, en } = baseFixture()
    setKey(he, 'itemCount_two', 'שני פריטים')

    const legacyErrors = validateNamespacePairLegacy7Rule(he, en)
    const currentErrors = validateNamespacePair(he, en)

    expect(legacyErrors).toEqual([])
    expect(currentErrors.length).toBeGreaterThan(0)
  })

  it('the legacy and current validators still agree on a Rule 1–7 violation (no behavior lost, only gained)', () => {
    const { he, en } = baseFixture()
    removeKey(he, 'greeting')

    const legacyErrors = validateNamespacePairLegacy7Rule(he, en)
    const currentErrors = validateNamespacePair(he, en)

    expect(legacyErrors.join('\n')).toContain('base key "greeting" is missing in: he')
    expect(currentErrors.join('\n')).toContain('base key "greeting" is missing in: he')
  })
})
