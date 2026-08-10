import { describe, expect, it } from 'vitest'
import catalogHe from './he/catalog.json'
import catalogEn from './en/catalog.json'
import { flatten, indexKeys, placeholders, valueAt, validateNamespacePair, type LocaleTree } from './localeIntegrity'

/**
 * Namespace-integrity test for `catalog` — UI_IMPLEMENTATION_PLAN.md §13,
 * tier 1: "i18n key symmetry between he and en — catches the classic
 * drift". Slice 9 Checkpoint C; consolidated onto the shared validator at
 * Slice 10 Checkpoint B.
 *
 * Pure JSON validation via the shared `localeIntegrity.ts` validator (the
 * full 9-rule contract this namespace originated — see that module's own
 * doc comment). The generic rule-mechanism mutation proofs now live in
 * `localeIntegrity.test.ts`, proven against a synthetic fixture — this file
 * keeps only what is specific to the `catalog` namespace: that the real
 * shipped pair is sound, its required keys, its own plural/category shape,
 * and the `emptyCategoryMessage` `{{category}}` contract (Checkpoint B
 * decision — kept local per the approved plan).
 */

const HE = catalogHe as unknown as LocaleTree
const EN = catalogEn as unknown as LocaleTree

function clone(tree: LocaleTree): LocaleTree {
  return structuredClone(tree)
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
  it('satisfies every rule under the shared 9-rule contract', () => {
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

  it('rejects a dropped {{category}} placeholder on emptyCategoryMessage', () => {
    const he = setKey(clone(HE), 'catalogPage.emptyCategoryMessage', 'אין מוצרים בקטגוריה הזו כרגע.')

    expect(validateNamespacePair(he, EN).join('\n')).toContain(
      '"catalogPage.emptyCategoryMessage" uses different interpolation placeholders',
    )
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

  /**
   * MILESTONE-005 Checkpoint J, §7c — Product Details lives in the EXISTING
   * `catalog` namespace. These keys are held to exactly the same contract as
   * every other key here: the shared 9-rule validator above already covers
   * he/en symmetry and placeholder agreement, so this block pins the
   * specific keys the page cannot render without, plus `imageAlt`'s
   * interpolation contract.
   */
  it.each([
    'productDetails.loading',
    'productDetails.error',
    'productDetails.retry',
    'productDetails.notFoundHeading',
    'productDetails.notFoundMessage',
    'productDetails.backToCatalog',
    'productDetails.imageAlt',
    'productDetails.gallery',
    'productDetails.description',
    'productDetails.usageInstructions',
    'productDetails.warningsAllergens',
    'productDetails.ingredients',
    'productDetails.ingredientName',
    'productDetails.ingredientAmount',
    'productDetails.healthGoals',
    'productDetails.specifications',
    'productDetails.brand',
    'productDetails.category',
    'productDetails.dosageForm',
    'productDetails.packageQuantity',
    'productDetails.targetAudience',
    'productDetails.createdAt',
    'productDetails.serialNumber',
  ])('defines the required Product Details key "%s" in both locales, non-empty', (path) => {
    const heValue = valueAt(HE, path)
    const enValue = valueAt(EN, path)
    expect(typeof heValue).toBe('string')
    expect(typeof enValue).toBe('string')
    expect((heValue as string).trim()).not.toBe('')
    expect((enValue as string).trim()).not.toBe('')
  })

  it('carries exactly the {{product}}, {{index}} and {{total}} placeholders on imageAlt, in both locales', () => {
    for (const tree of [HE, EN]) {
      expect(placeholders(valueAt(tree, 'productDetails.imageAlt') as string).sort()).toEqual([
        'index',
        'product',
        'total',
      ])
    }
  })

  it('rejects a dropped placeholder on imageAlt', () => {
    const he = setKey(clone(HE), 'productDetails.imageAlt', 'תמונה {{index}} מתוך {{total}}')
    expect(validateNamespacePair(he, EN).join('\n')).toContain(
      '"productDetails.imageAlt" uses different interpolation placeholders',
    )
  })

  it('does NOT create a separate productDetails namespace — §7c freezes these into `catalog`', () => {
    // The guard is structural: these keys live under a `productDetails`
    // OBJECT inside the catalog namespace, not in a namespace of their own.
    // `i18n/resources.test.ts` independently guards the registered
    // namespace list against drift.
    expect(typeof valueAt(HE, 'productDetails')).toBe('object')
    expect(typeof valueAt(EN, 'productDetails')).toBe('object')
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
