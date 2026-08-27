// MILESTONE-011 Checkpoint A — MockProvider unit tests. Deterministic by
// construction; these pin the branches the route depends on (criteria /
// clarify) and the DTO-only explanation contract.

import { describe, expect, it } from 'vitest'
import type { PublicCatalogProduct } from '../catalogMapper.js'
import { MockProvider } from './mockProvider.js'

const provider = new MockProvider()

async function extract(message: string, lang: 'he' | 'en' = 'he') {
  return provider.extractCriteria(message, [], lang)
}

describe('MockProvider.extractCriteria', () => {
  it('maps a Hebrew ingredient word', async () => {
    const result = await extract('מגנזיום')
    expect(result.kind).toBe('criteria')
    if (result.kind !== 'criteria') return
    expect(result.criteria.ingredients).toContain('מגנזיום')
  })

  it('maps an English goal + a price ceiling in one sentence', async () => {
    const result = await extract('something for sleep under 100', 'en')
    expect(result.kind).toBe('criteria')
    if (result.kind !== 'criteria') return
    expect(result.criteria.healthGoals).toContain('Sleep')
    expect(result.criteria.priceMax).toBe('100')
  })

  it('maps "עד 100 שקל" to priceMax', async () => {
    const result = await extract('משהו לחיזוק חיסון עד 100 שקל')
    expect(result.kind).toBe('criteria')
    if (result.kind !== 'criteria') return
    expect(result.criteria.healthGoals).toContain('חיזוק חיסון')
    expect(result.criteria.priceMax).toBe('100')
  })

  it('maps dietary words and stock words', async () => {
    const result = await extract('ויטמין C בלי גלוטן במלאי')
    expect(result.kind).toBe('criteria')
    if (result.kind !== 'criteria') return
    expect(result.criteria.glutenFree).toBe(true)
    expect(result.criteria.inStockOnly).toBe(true)
    expect(result.criteria.ingredients).toContain('ויטמין C')
  })

  it('maps a dosage-form word straight to the enum', async () => {
    const result = await extract('משהו בטיפות בבקשה')
    expect(result.kind).toBe('criteria')
    if (result.kind !== 'criteria') return
    expect(result.criteria.dosageForms).toContain('DROPS')
  })

  it('maps English ingredient words to the HEBREW taxonomy name (the linked name space)', async () => {
    const result = await extract('do you have magnesium and iron?', 'en')
    expect(result.kind).toBe('criteria')
    if (result.kind !== 'criteria') return
    expect(result.criteria.ingredients).toContain('מגנזיום')
    expect(result.criteria.ingredients).toContain('ברזל')
  })

  it('🔴 short Hebrew keys match whole tokens only — "חלבון" must not fire the heart goal', async () => {
    // 'טבעונית' keeps the branch on 'criteria' so the assertion below can
    // never pass vacuously through the clarify branch.
    const protein = await extract('אני מחפש אבקת חלבון טבעונית')
    expect(protein.kind).toBe('criteria')
    if (protein.kind !== 'criteria') return
    expect(protein.criteria.healthGoals).not.toContain('לב וכלי דם')
    // And the control direction: a genuine heart request still fires.
    const heart = await extract('משהו ללב')
    expect(heart.kind).toBe('criteria')
    if (heart.kind !== 'criteria') return
    expect(heart.criteria.healthGoals).toContain('לב וכלי דם')
  })

  it('"שיעור" does not fire the skin-and-hair goal; "לעור" does', async () => {
    // ISSUE-150 changed the contract's second half: unmatched content now
    // leaves as productQuery and THE ROUTE's search is the arbiter (zero
    // matches → the coded clarify). What this test still owns: the token
    // guard — "שיעור" must not smuggle in the skin-and-hair GOAL.
    const lesson = await extract('שיעור כימיה')
    expect(lesson.kind).toBe('criteria')
    if (lesson.kind !== 'criteria') return
    expect(lesson.criteria.healthGoals).toEqual([])
    expect(lesson.criteria.productQuery).toBe('שיעור כימיה')

    const skin = await extract('משהו לעור')
    expect(skin.kind).toBe('criteria')
    if (skin.kind !== 'criteria') return
    expect(skin.criteria.healthGoals).toContain('עור ושיער')
    // Control: a matched goal means NO productQuery rides along.
    expect(skin.criteria.productQuery).toBeUndefined()
  })

  it('ISSUE-150: a product-name-ish message emits productQuery with the filler stripped', async () => {
    const named = await extract('תוכל להראות לי בריאמיל בבקשה?')
    expect(named.kind).toBe('criteria')
    if (named.kind !== 'criteria') return
    expect(named.criteria.productQuery).toBe('בריאמיל')
    expect(named.criteria.ingredients).toEqual([])
  })

  it('asks a clarifying question when nothing matched — in the request language', async () => {
    const he = await extract('שלום, אפשר עזרה?')
    expect(he.kind).toBe('clarify')
    if (he.kind === 'clarify') expect(he.question).toMatch(/רכיב|מטרה|מחיר/)

    const en = await extract('hello, can you help me?', 'en')
    expect(en.kind).toBe('clarify')
    if (en.kind === 'clarify') expect(en.question).toMatch(/ingredient|goal|price/)
  })
})

describe('MockProvider.explainProducts', () => {
  const product: PublicCatalogProduct = {
    slug: 'test-product',
    nameHe: 'מגנזיום ציטראט',
    nameEn: 'Magnesium Citrate',
    categoryNameHe: 'מינרלים',
    categoryNameEn: 'Minerals',
    categorySlug: 'minerals',
    brandName: 'אלטמן',
    brandNameEn: 'Altman',
    dosageForm: 'CAPSULE',
    packageQuantity: 100,
    price: '89.90',
    stockQuantity: 12,
    lowStockThreshold: 5,
    imageFile: null,
    shortDescriptionHe: 'תקציר בדיקה',
    shortDescriptionEn: 'Fixture short description',
  }

  it('builds one explanation per product, from DTO fields only, per language', async () => {
    const he = await provider.explainProducts([product], 'מגנזיום', 'he')
    expect(he.explanations).toHaveLength(1)
    expect(he.explanations[0]).toContain('מגנזיום ציטראט')
    expect(he.explanations[0]).toContain('אלטמן')
    // DEC-104 — one product is never a "top pick".
    expect(he.topPickIndex).toBeNull()

    const en = await provider.explainProducts([product], 'magnesium', 'en')
    expect(en.explanations).toHaveLength(1)
    expect(en.explanations[0]).toContain('Magnesium Citrate')
    expect(en.explanations[0]).toContain('Altman')
  })

  it('🔴 DEC-104 — ranks the CHEAPEST product as the top pick (ties → the earliest)', async () => {
    const dearer = { ...product, slug: 'dearer', price: '99.90' }
    const cheaper = { ...product, slug: 'cheaper', price: '19.90' }
    const tie = { ...product, slug: 'tie', price: '19.90' }
    const result = await provider.explainProducts([dearer, cheaper, tie], 'מגנזיום', 'he')
    expect(result.topPickIndex).toBe(1)
  })

  it('returns an empty result for an empty product list', async () => {
    await expect(provider.explainProducts([], 'anything', 'he')).resolves.toEqual({ explanations: [], topPickIndex: null })
  })
})
