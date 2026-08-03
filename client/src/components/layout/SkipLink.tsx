import { useTranslation } from 'react-i18next'
import { VisuallyHidden } from '../ui/VisuallyHidden'

/**
 * Skip link to #main — invisible at rest, revealed on keyboard focus,
 * first in tab order.
 *
 * Sits at `--z-overlay` (50), numerically identical to the bare `z-50` it
 * replaces, so its behaviour against page content is unchanged. It is
 * deliberately BELOW `--z-modal`, and that is not a conflict: the skip
 * link lives inside #root, which `useBackgroundInert` makes inert while
 * any overlay is open, so it cannot be focused or revealed at the only
 * moment the two layers could compete. Before DEC-039 it tied with the
 * mobile menu's bare `z-50`, resolved only by stylesheet order.
 */
export function SkipLink() {
  const { t } = useTranslation('layout')

  return (
    <VisuallyHidden
      as="a"
      href="#main"
      focusable
      className="focus-ring z-[var(--z-overlay)] block w-fit rounded-card bg-brand-teal px-4 py-2 text-sm font-medium text-white"
    >
      {t('skipLink')}
    </VisuallyHidden>
  )
}
