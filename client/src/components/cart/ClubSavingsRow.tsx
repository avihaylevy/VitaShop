import { useTranslation } from 'react-i18next'
import type { Cart } from '../../types/cart'
import { PriceBlock } from '../catalog/PriceBlock'

/**
 * The seventh list, item 2 — the club's worth in shekels, ONE component for
 * both cart surfaces (review finding: the row was pasted byte-for-byte into
 * CartPage and CartDrawer, and this directory already factors shared cart
 * UI exactly this way — CartItemRow, CartOutcomeNotice).
 *
 * This component OWNS the two rules the copies were repeating:
 *   · the '0.00' gate — a savings row about nothing reads as a bug, so a
 *     zero figure renders nothing at all;
 *   · the reading — the SERVER's clubMember flag picks the sentence: a
 *     member is told what they are saving, a non-member what joining would
 *     save. Same figure either way, by the server's construction.
 *
 * 🔴 String comparison only; the figure is rendered, never derived (§3.4).
 */
export function ClubSavingsRow({ cart }: { cart: Cart }) {
  const { t } = useTranslation('club')

  if (cart.clubSavings === '0.00') return null

  return (
    <p className="flex flex-wrap items-baseline gap-2">
      <span className="text-xs text-state-commerce">
        {t(cart.clubMember ? 'savings.member' : 'savings.join')}
      </span>
      <PriceBlock price={cart.clubSavings} />
    </p>
  )
}
