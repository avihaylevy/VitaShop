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
 * The thirteenth list (2026-08-21) + the user's follow-up (2026-08-22): a
 * form measured by VOLUME or WEIGHT shows its quantity in that unit, not as
 * a unit count — "250 מ״ל", never "250 טיפות". DROPS and SYRUP are מ״ל;
 * POWDER is גרם. Keyed by dosage form; a form absent here is countable and
 * keeps the quantity+form-label pairing.
 *
 * ⚠️ The ingredients table renders its OWN units raw from the DB ("mg",
 * "ml") — deliberately not localized here. If ingredient units ever get
 * localized, that table must share THIS vocabulary, not grow a second one.
 */
const PACKAGE_UNIT_LABELS: Record<SupportedLanguage, Record<string, string>> = {
  he: catalogHe.packageUnit,
  en: catalogEn.packageUnit,
}

/**
 * Maps a bilingual catalogue DTO to the language-resolved
 * `ProductCardModel` the card already renders. Never invents text: an
 * unrecognised dosage-form key is simply omitted (ProductCard already
 * treats a missing `dosageForm` as "omit the segment"), not replaced with
 * a placeholder.
 */
/**
 * The one lookup other surfaces use for the same rule — the CART row renders
 * "כמות באריזה: 250 מ״ל" through this, so the unit vocabulary cannot fork.
 * Undefined = a countable form; the caller keeps its unit-less string.
 */
export function packageUnitLabel(
  dosageForm: string | undefined,
  language: SupportedLanguage,
): string | undefined {
  return dosageForm === undefined ? undefined : PACKAGE_UNIT_LABELS[language][dosageForm]
}

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
    // DEC-085 (user, 2026-08-15): the brand reads in its manufacturer Latin
    // form in BOTH languages, everywhere it renders — cards, detail, home
    // showcase. Fallback stays per product: no sourced Latin form, stored
    // name. The PRODUCT name stays language-branched; only the brand flips.
    brandName: dto.brandNameEn ?? dto.brandName,
    dosageForm: DOSAGE_FORM_LABELS[language][dto.dosageForm],
    packageQuantity: dto.packageQuantity,
    packageUnit: PACKAGE_UNIT_LABELS[language][dto.dosageForm],
    imageFile: dto.imageFile,
  }
}
