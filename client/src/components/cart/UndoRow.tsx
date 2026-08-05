import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'

type UndoRowProps = {
  /** The removed line's stored name snapshot. Never retranslated (D4). */
  productName: string
  onUndo: () => void
  /**
   * Lets CartPage move focus to the Undo control once the row is in the
   * committed DOM.
   *
   * 🔴 A ref to the ROW, not to the button: the shared `Button` primitive does
   * not forward refs, and `components/ui/` is out of scope for this slice. The
   * caller resolves the single button inside this container — a scope of one
   * element, never a page-wide selector and never a translated-text query.
   */
  rowRef?: Ref<HTMLDivElement>
}

/**
 * DESIGN_SYSTEM.md §8: "Removal is reversible — an inline `role="status"` row
 * offers `ביטול ההסרה`."
 *
 * 🔴 `role="status"` is polite by definition. Nothing here is assertive: a
 * removal the shopper just performed is not an error, and an assertive region
 * would interrupt them mid-sentence.
 *
 * 🔴 No timer, no automatic expiry, no close button, no toast, no modal, no
 * animation. Undo stays until the shopper takes it or the cart changes
 * underneath it — nothing disappears on a clock a keyboard or screen-reader
 * user cannot outrun.
 */
export function UndoRow({ productName, onUndo, rowRef }: UndoRowProps) {
  const { t } = useTranslation('cart')

  return (
    <div
      ref={rowRef}
      role="status"
      className="mt-4 flex flex-wrap items-center gap-3 rounded-card border border-border-hairline bg-surface-sunken px-4 py-3"
    >
      <p className="text-sm text-text-ink">{t('undo.message', { product: productName })}</p>
      <Button
        variant="secondary"
        onClick={onUndo}
        aria-label={t('undo.actionAriaLabel', { product: productName })}
      >
        {t('undo.action')}
      </Button>
    </div>
  )
}
