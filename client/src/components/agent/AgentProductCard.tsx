import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ProductCardModel } from '../../types/product'
import { getStockState } from '../../lib/stockState'
import { PriceBlock } from '../catalog/PriceBlock'
import { ProductImage } from '../catalog/ProductImage'
import { StockState } from '../catalog/StockState'
import { ADD_TO_CART_ATTRIBUTE } from '../catalog/ProductCard'
import { Button } from '../ui/Button'
import { Surface } from '../ui/Surface'
import { Badge } from '../ui/Badge'
import { FOCUS_RING } from '../ui/focusRing'

/**
 * MILESTONE-011 Checkpoint B — the compact card an agent turn renders.
 *
 * 🔴 THE CATALOGUE CARD'S LINK CONTRACT, at panel scale (plan §11.3 C2):
 * exactly ONE accessible link (the product name → the detail page) and ONE
 * button (add to cart) per card — no stepper, no favourite heart, nothing
 * nested. Facts (name · brand · price · stock) render FROM THE DTO-derived
 * model; the LLM's explanation is a sibling paragraph the PARENT renders
 * beside this card, never a source of a fact (AI_SAFETY_RULES layer 4).
 *
 * 🔴 REQ-F-076 / C3: the add button calls the SAME useAddToCart handler
 * every other surface uses — the agent never adds on its own initiative;
 * this button is the explicit user action.
 */
export function AgentProductCard({
  product,
  explanation,
  explanationLang,
  topPick = false,
  onAddToCart,
  onNavigateClick,
}: {
  product: ProductCardModel
  explanation: string
  /** DEC-104 — this card is the provider's server-validated top pick. */
  topPick?: boolean
  /** The language the explanation was authored in — frozen provider prose. */
  explanationLang: 'he' | 'en'
  onAddToCart: (slug: string, quantity: number) => void | Promise<boolean>
  /**
   * The panel closes itself when the name link leaves for the detail page.
   * Receives the click event — the caller declines modified clicks.
   */
  onNavigateClick: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const { t } = useTranslation('agent')
  const isOut = getStockState(product.stockQuantity, product.lowStockThreshold) === 'out'

  return (
    <div className="flex flex-col gap-1.5">
      <Surface
        as="article"
        variant="section"
        bordered
        className="flex flex-col gap-2.5 p-3"
      >
        {topPick && (
          /* DEC-104 — the ranked pick, in the agent's own plum accent so
             it reads as the ASSISTANT's opinion, never a commerce claim.
             ui/Badge, not a hand-rolled span (review finding: the first
             draft used rounded-round, the shape Badge's own doc reserves
             for dots and counts, never text labels). */
          <Badge variant="agent" className="self-start">
            {t('reply.topPick')}
          </Badge>
        )}
        {/* ISSUE-164 — a product THUMBNAIL joins the card (the same
            ProductImage pipeline every catalogue surface uses: filename /
            external URL / upload path, contain-only), and the text column
            sits beside it at chat scale. */}
        <div className="flex items-start gap-3">
          <div className="w-16 shrink-0 overflow-hidden rounded-compact">
            <ProductImage imageFile={product.imageFile} alt="" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h4 className="text-sm font-semibold leading-6 text-text-ink">
              {/* Navigating from inside the panel closes it — the page the
                  link lands on must not sit under a modal (review, Checkpoint
                  B's altitude finding). onClick never prevents the Link's own
                  navigation. */}
              <Link
                to={`/product/${product.slug}`}
                onClick={onNavigateClick}
                className={`${FOCUS_RING} rounded-compact`}
              >
                {product.name}
              </Link>
            </h4>
            {product.brandName && (
              <p className="text-xs font-semibold text-text-muted">{product.brandName}</p>
            )}
            <StockState
              stockQuantity={product.stockQuantity}
              lowStockThreshold={product.lowStockThreshold}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-hairline pt-2">
          <PriceBlock price={product.price} size="price" />
          <Button
            variant="primary"
            disabled={isOut}
            onClick={() => onAddToCart(product.slug, 1)}
            // The slug-bound hook every add surface stamps (ProductCard's
            // contract) — kept consistent even though the agent's cart
            // drawer deliberately returns focus to the floating button
            // instead (see AgentWidget).
            {...{ [ADD_TO_CART_ATTRIBUTE]: product.slug }}
          >
            {t('addToCart')}
          </Button>
        </div>
      </Surface>
      {explanation !== '' && (
        /* The ONE thing the model wrote — beside the card, never inside a
           factual field. An empty string (guard-rejected prose) simply
           renders nothing; the card stands on the DTO alone. lang/dir mark
           the frozen prose so a language toggle renders attributed mixed
           content, not an unmarked RTL/LTR jumble. */
        <p
          lang={explanationLang}
          dir={explanationLang === 'he' ? 'rtl' : 'ltr'}
          className="px-1 text-[13px] leading-5 text-text-muted"
        >
          {explanation}
        </p>
      )}
    </div>
  )
}
