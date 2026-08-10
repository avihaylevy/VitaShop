import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { ProductGrid } from './ProductGrid'
import type { CatalogFallback } from '../../features/catalog/catalogViewState'

type CatalogFallbackSectionProps = {
  fallback: CatalogFallback
  onAddToCart: (slug: string) => void
  className?: string
}

/**
 * MILESTONE-005 Checkpoint I — §6b's client obligation, which the plan
 * states is "a required acceptance criterion of Checkpoints F and I, not a
 * styling preference":
 *
 *   🔴 the UI must visibly AND semantically distinguish "no matching
 *   products" from "suggested products" — a distinct heading and a separate
 *   region, never fallback items rendered into the normal results grid.
 *
 * How that is met here:
 * - a `<section>` of its own, named by its own `<h2>` (`aria-labelledby`) —
 *   the empty-state region and this one are separate landmarks with
 *   different names;
 * - the heading text names the suggestion KIND (`category` vs `popular`),
 *   never "results";
 * - an explicit note states these are suggestions, so the distinction is
 *   carried by text, not by position or styling alone;
 * - the honest count comes from `fallback.limit`/`items.length`, never
 *   invented — §6b echoes `limit` precisely so the client can say "showing
 *   N suggestions" truthfully.
 *
 * There is no pagination here and none is invented: §6b forbids paginating
 * the fallback set.
 */
export function CatalogFallbackSection({ fallback, onAddToCart, className = '' }: CatalogFallbackSectionProps) {
  const { t } = useTranslation('catalog')
  const headingId = useId()

  if (fallback.items.length === 0) return null

  return (
    <section aria-labelledby={headingId} className={`mt-10 border-t border-border-hairline pt-6 ${className}`}>
      <h2 id={headingId} className="text-lg font-semibold text-text-ink">
        {fallback.kind === 'category' ? t('fallback.categoryHeading') : t('fallback.popularHeading')}
      </h2>
      <p className="mt-1 text-sm text-text-muted">{t('fallback.note')}</p>
      <p className="mt-1 text-sm text-text-muted">{t('fallback.count', { count: fallback.items.length })}</p>
      <div className="mt-4">
        <ProductGrid products={fallback.items} onAddToCart={onAddToCart} showCategoryEyebrow />
      </div>
    </section>
  )
}
