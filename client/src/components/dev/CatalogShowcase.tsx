import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ProductCard } from '../catalog/ProductCard'
import { ProductGrid } from '../catalog/ProductGrid'
import { VERIFIED_PRODUCT_FIXTURES, SYNTHETIC_VARIANTS, toProductCardModel } from './catalogFixtures'

/**
 * 🔴 Development only. Gated at the route in App.tsx behind
 * import.meta.env.DEV, tree-shaken out of a production build — see
 * OverlayShowcase for the same pattern and its dist/ verification note.
 *
 * Renders only the six DEC-032 verified product fixtures, plus synthetic
 * stock/image variants cloned from them. No CartContext — onAddToCart is
 * a local callback, its last-invoked slug shown as dev-only feedback.
 *
 * The 1/2/3-product sections exist solely so Checkpoint C's responsive
 * column-count and short-final-row behavior can be checked against real
 * DOM subsets, not just the full six.
 *
 * Text here is intentionally not translated: it is not product UI.
 */
export function CatalogShowcase() {
  const { i18n } = useTranslation()
  const language = i18n.language === 'he' ? 'he' : 'en'
  const [lastAddedSlug, setLastAddedSlug] = useState<string | null>(null)

  const sixModels = VERIFIED_PRODUCT_FIXTURES.map((fixture) => toProductCardModel(fixture, language))

  return (
    <div className="flex flex-col gap-6 px-7 py-8">
      <h1 className="text-2xl font-semibold text-text-ink">Catalog showcase (dev only)</h1>

      <p className="text-sm text-text-muted">
        Last add-to-cart callback: {lastAddedSlug ?? '(none yet)'}
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-text-ink">Six verified products</h2>
        <ProductGrid products={sixModels} onAddToCart={setLastAddedSlug} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-text-ink">One product</h2>
        <ProductGrid products={sixModels.slice(0, 1)} onAddToCart={setLastAddedSlug} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-text-ink">Two products</h2>
        <ProductGrid products={sixModels.slice(0, 2)} onAddToCart={setLastAddedSlug} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-text-ink">Three products</h2>
        <ProductGrid products={sixModels.slice(0, 3)} onAddToCart={setLastAddedSlug} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-text-ink">Empty state</h2>
        <ProductGrid
          products={[]}
          onAddToCart={setLastAddedSlug}
          emptyState={<p className="text-sm text-text-muted">No products to show.</p>}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-text-ink">Synthetic state variants</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SYNTHETIC_VARIANTS.map((variant) => (
            <div key={variant.fixture.slug} className="flex flex-col gap-2">
              <p className="text-xs font-medium text-text-muted">{variant.label}</p>
              <ProductCard
                {...toProductCardModel(variant.fixture, language)}
                onAddToCart={setLastAddedSlug}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
