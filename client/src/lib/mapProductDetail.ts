import { mapCatalogProduct } from './mapCatalogProduct.js'
import type { ProductDetailDto } from '../types/catalog.js'
import type { ProductDetailModel } from '../types/product.js'
import type { SupportedLanguage } from '../i18n/index.js'

/**
 * MILESTONE-005 Checkpoint J — maps the §7a detail DTO to the
 * language-resolved `ProductDetailModel`.
 *
 * 🔴 Built ON TOP of `mapCatalogProduct`, never beside it: every field the
 * card already knows how to resolve (name, category, dosage-form label,
 * price, stock) is resolved by that one call, so the detail page cannot
 * drift from the card — the client mirror of the server's "detail DTO
 * extends the list DTO" rule.
 *
 * Pure and DOM-free, like `mapCatalogProduct`: no i18next instance, no
 * `document`. Language-independent values (the Hebrew-only manufacturer
 * texts, the ISO timestamp, `serialNumber`) pass through untouched — nothing
 * here invents or formats text.
 */
export function mapProductDetail(dto: ProductDetailDto, language: SupportedLanguage): ProductDetailModel {
  return {
    ...mapCatalogProduct(dto, language),
    serialNumber: dto.serialNumber,
    usageInstructions: dto.usageInstructions,
    images: dto.images,
    description: language === 'he' ? dto.descriptionHe : dto.descriptionEn,
    warningsAllergens: dto.warningsAllergens,
    ingredients: dto.ingredients.map((ingredient) => ({
      name: ingredient.name,
      amount: ingredient.amount,
      unit: ingredient.unit,
    })),
    healthGoals: dto.healthGoals.map((goal) => (language === 'he' ? goal.nameHe : goal.nameEn)),
    targetAudience: dto.targetAudience,
    createdAt: dto.createdAt,
  }
}
