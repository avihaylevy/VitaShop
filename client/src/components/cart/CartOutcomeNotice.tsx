import { useTranslation } from 'react-i18next'
import type { CartMutationOutcome } from '../../types/cart'

type CartOutcomeNoticeProps = {
  outcome: CartMutationOutcome | null
  /** Language-resolved product name for `outcome.subject`, when one is known. */
  productName?: string
}

/**
 * 🔴 THE SERVER SAID WHAT IT CHANGED. THIS SAYS IT OUT LOUD.
 *
 * `clampedByCap`, `clampedByStock` and `alreadyAtMaximum` were added to the
 * cart API for exactly one reason — §7.4: *"a silent clamp is a lie the UI
 * cannot render"*. A migration that receives them and drops them on the floor
 * re-creates the silent loss six server checkpoints were spent removing, and it
 * looks completely fine while doing it.
 *
 * The message always states the quantity the SERVER settled on, never the one
 * the shopper typed.
 *
 * `role="status"` is polite by definition: a clamp is not an error and must not
 * interrupt anyone mid-sentence. The region is always in the DOM — mounting it
 * conditionally would leave the FIRST message unannounced.
 */
export function CartOutcomeNotice({ outcome, productName }: CartOutcomeNoticeProps) {
  const message = useCartOutcomeMessage(outcome, productName)

  return (
    <div role="status" aria-live="polite" className="empty:hidden">
      {message && (
        <p className="mt-4 rounded-card border border-border-hairline bg-surface-sunken px-4 py-3 text-sm text-text-ink">
          {message}
        </p>
      )}
    </div>
  )
}

/**
 * The same sentence WITHOUT a live region, for callers that must not have one.
 *
 * 🔴 `CartDrawer` is such a caller: DEC-047 D5 forbids any live region inside
 * it, because a focused dialog already announces its own content and a region
 * would double-announce every add. The information still has to reach the
 * shopper, so the drawer renders this string as ordinary text inside the
 * dialog. Suppressing the MESSAGE to honour a rule about the REGION would have
 * been the wrong half to drop.
 */
export function useCartOutcomeMessage(
  outcome: CartMutationOutcome | null,
  productName?: string,
): string {
  const { t } = useTranslation('cart')
  return outcome ? messageFor(outcome, productName ?? outcome.subject, t) : ''
}

type Translate = ReturnType<typeof useTranslation>['t']

/**
 * Order matters and is not arbitrary. A no-op ("nothing moved") ranks above a
 * clamp, because a shopper who pressed a control and saw no change needs that
 * explained before anything else. Both clamp reasons can be true at once; stock
 * is the more specific and more actionable of the two, so it wins.
 *
 * 🔴 A REMOVAL IS DELIBERATELY NOT REPORTED HERE, and it is not dropped either:
 * `UndoRow` is the removal announcement (DESIGN_SYSTEM.md §8 — an inline
 * `role="status"` naming the product, with the undo control in it). Reporting it
 * in both places was found in the browser pass announcing the same removal
 * twice, once naming the product and once naming its SLUG.
 */
function messageFor(outcome: CartMutationOutcome, product: string, t: Translate): string {
  if (outcome.removed) return ''
  if (outcome.alreadyAtMaximum) return t('outcome.alreadyAtMaximum', { product, quantity: outcome.quantity })
  if (outcome.clampedByStock) return t('outcome.clampedByStock', { product, quantity: outcome.quantity })
  if (outcome.clampedByCap) return t('outcome.clampedByCap', { product, quantity: outcome.quantity })
  return ''
}
