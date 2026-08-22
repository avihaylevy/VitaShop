import type { ProductCardModel } from '../../types/product'

/**
 * 🔴 Development only, imported solely by CatalogShowcase (itself gated
 * behind import.meta.env.DEV in App.tsx) — tree-shaken out of production.
 *
 * The six DEC-032 verified rows from assets/products/products.csv
 * (verified=yes), catalogue fields only. No description, ingredients,
 * benefits, dosage instructions, warnings, allergens, ratings, sale claims
 * or certifications — those columns are never read here.
 */
type RawFixture = {
  slug: string
  imageFile: string | null
  nameHe: string
  nameEn: string
  categoryNameHe: string
  categoryNameEn: string
  brandName: string
  price: string
  stockQuantity: number
  lowStockThreshold: number
  // ⚠️ These fixtures BYPASS mapCatalogProduct, so they carry no packageUnit.
  // Add a drops/syrup/powder fixture only through the real mapper, or it will
  // render the banned "250 טיפות" form.
  dosageFormHe: string
  dosageFormEn: string
  packageQuantity: number
}

// schema.prisma: Product.lowStockThreshold @default(5)
const DEFAULT_LOW_STOCK_THRESHOLD = 5

export const VERIFIED_PRODUCT_FIXTURES: readonly RawFixture[] = [
  {
    slug: 'solgar-omega-3',
    imageFile: 'אומגה 3 של חברת סולגאר.jpg',
    nameHe: 'אומגה 3',
    nameEn: 'Omega 3',
    categoryNameHe: 'אומגה ושומנים',
    categoryNameEn: 'Omega & Fats',
    brandName: 'סולגאר',
    price: '94.90',
    stockQuantity: 60,
    lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
    dosageFormHe: 'כמוסות',
    dosageFormEn: 'capsules',
    packageQuantity: 100,
  },
  {
    slug: 'solgar-vitamin-c-berry',
    imageFile: 'ויטמין C בטעם פטל חמוציות של חברת סולגאר.jpg',
    nameHe: 'ויטמין C בטעם פטל חמוציות',
    nameEn: 'Vitamin C Raspberry Cranberry',
    categoryNameHe: 'ויטמינים',
    categoryNameEn: 'Vitamins',
    brandName: 'סולגאר',
    price: '69.90',
    stockQuantity: 80,
    lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
    dosageFormHe: 'טבליות',
    dosageFormEn: 'tablets',
    packageQuantity: 90,
  },
  {
    slug: 'superherb-vitamin-d',
    imageFile: 'טבליות ויטמין D של חברת סופרהרב.jpg',
    nameHe: 'ויטמין D במינון 1,000 יחב"ל',
    nameEn: 'Vitamin D 1000 IU',
    categoryNameHe: 'ויטמינים',
    categoryNameEn: 'Vitamins',
    brandName: 'סופהרב',
    price: '49.90',
    stockQuantity: 100,
    lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
    dosageFormHe: 'כמוסות',
    dosageFormEn: 'capsules',
    packageQuantity: 180,
  },
  {
    slug: 'superherb-magnesium-max-550',
    imageFile: 'מגנזיות מקס 550 של חברת סופרהרב.jpg',
    nameHe: 'מגנזיום מקס 550',
    nameEn: 'Magnesium Max 550',
    categoryNameHe: 'מינרלים',
    categoryNameEn: 'Minerals',
    brandName: 'סופהרב',
    price: '84.90',
    stockQuantity: 50,
    lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
    dosageFormHe: 'כמוסות',
    dosageFormEn: 'capsules',
    packageQuantity: 60,
  },
  {
    slug: 'solgar-b12',
    imageFile: 'סולגר טבליות ויטמין B12.jpg',
    nameHe: 'ויטמין B12 לבליעה במינון 100 מק"ג',
    nameEn: 'Vitamin B12 100 mcg (Swallow Tablets)',
    categoryNameHe: 'ויטמינים',
    categoryNameEn: 'Vitamins',
    brandName: 'סולגאר',
    price: '64.90',
    stockQuantity: 70,
    lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
    dosageFormHe: 'טבליות',
    dosageFormEn: 'tablets',
    packageQuantity: 100,
  },
  {
    slug: 'solgar-cal-mag-d3',
    imageFile: 'סולגר טבליות סידן ומגנזיום בתוספת ויטמין D3.jpg',
    nameHe: 'סידן ומגנזיום בתוספת ויטמין D3',
    nameEn: 'Calcium Magnesium with Vitamin D3',
    categoryNameHe: 'מינרלים',
    categoryNameEn: 'Minerals',
    brandName: 'סולגאר',
    price: '79.90',
    stockQuantity: 65,
    lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
    dosageFormHe: 'טבליות',
    dosageFormEn: 'tablets',
    packageQuantity: 150,
  },
] as const

/** Resolves a raw fixture row to the language-specific ProductCard view-model. */
export function toProductCardModel(fixture: RawFixture, language: 'he' | 'en'): ProductCardModel {
  return {
    slug: fixture.slug,
    name: language === 'he' ? fixture.nameHe : fixture.nameEn,
    categoryNameHe: fixture.categoryNameHe,
    categoryName: fixture.categoryNameEn,
    price: fixture.price,
    stockQuantity: fixture.stockQuantity,
    lowStockThreshold: fixture.lowStockThreshold,
    brandName: fixture.brandName,
    dosageForm: language === 'he' ? fixture.dosageFormHe : fixture.dosageFormEn,
    packageQuantity: fixture.packageQuantity,
    imageFile: fixture.imageFile,
  }
}

/**
 * Synthetic state variants (Checkpoint B scope): stock number / image
 * presence altered only, cloned from a verified fixture — no invented
 * product. Each variant reuses its base product's real data otherwise.
 */
export type SyntheticVariant = {
  label: string
  fixture: RawFixture
}

const [omega3, , , magnesium] = VERIFIED_PRODUCT_FIXTURES

export const SYNTHETIC_VARIANTS: readonly SyntheticVariant[] = [
  {
    label: 'Missing image',
    fixture: { ...omega3, imageFile: null, slug: `${omega3.slug}--missing-image` },
  },
  {
    label: 'Low stock',
    fixture: { ...magnesium, stockQuantity: 3, slug: `${magnesium.slug}--low-stock` },
  },
  {
    label: 'Out of stock',
    fixture: { ...magnesium, stockQuantity: 0, slug: `${magnesium.slug}--out-of-stock` },
  },
] as const
