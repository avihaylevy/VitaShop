import catalogHe from '../locales/he/catalog.json'
import catalogEn from '../locales/en/catalog.json'
import type { CatalogProductDto } from '../types/catalog.js'
import type { ProductCardModel } from '../types/product.js'
import type { SupportedLanguage } from '../i18n/index.js'

// Read directly from the catalog locale JSON rather than the running
// i18next instance: importing i18n/index.ts has module-load side effects
// (document.documentElement writes) that this pure, DOM-free module must
// not carry — see the Checkpoint C "no jsdom" constraint.
const DOSAGE_FORM_LABELS: Record<SupportedLanguage, Record<string, string>> = {
  he: catalogHe.dosageForm,
  en: catalogEn.dosageForm,
}

/**
 * Maps a bilingual catalogue DTO to the language-resolved
 * `ProductCardModel` the card already renders. Never invents text: an
 * unrecognised dosage-form key is simply omitted (ProductCard already
 * treats a missing `dosageForm` as "omit the segment"), not replaced with
 * a placeholder.
 */
export function mapCatalogProduct(dto: CatalogProductDto, language: SupportedLanguage): ProductCardModel {
  return {
    slug: dto.slug,
    name: language === 'he' ? dto.nameHe : dto.nameEn,
    categoryNameHe: dto.categoryNameHe,
    categoryName: language === 'he' ? dto.categoryNameHe : dto.categoryNameEn,
    price: dto.price,
    stockQuantity: dto.stockQuantity,
    lowStockThreshold: dto.lowStockThreshold,
    // ISSUE-127a — the English UI shows the brand's manufacturer-verified
    // Latin form when one is sourced; the Hebrew UI keeps the stored name.
    // (Latin-in-Hebrew-UI for Latin-native brands needs per-brand sourcing
    // and rides the ISSUE-124 enrichment wave.)
    brandName: (language === 'en' ? dto.brandNameEn : null) ?? dto.brandName,
    dosageForm: DOSAGE_FORM_LABELS[language][dto.dosageForm],
    packageQuantity: dto.packageQuantity,
    imageFile: dto.imageFile,
  }
}
