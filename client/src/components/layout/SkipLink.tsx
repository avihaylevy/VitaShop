import { useTranslation } from 'react-i18next'
import { VisuallyHidden } from '../ui/VisuallyHidden'

/** Skip link to #main — invisible at rest, revealed on keyboard focus, first in tab order. */
export function SkipLink() {
  const { t } = useTranslation('layout')

  return (
    <VisuallyHidden
      as="a"
      href="#main"
      focusable
      className="focus-ring z-50 block w-fit rounded-card bg-brand-teal px-4 py-2 text-sm font-medium text-white"
    >
      {t('skipLink')}
    </VisuallyHidden>
  )
}
