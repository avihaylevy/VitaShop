import { useTranslation } from 'react-i18next'
import { Button } from './Button'

/**
 * MILESTONE-010 review — the admin pager, extracted from the byte-similar
 * copies in AdminOrdersPage and AdminProductsPage. The copies had ALREADY
 * drifted in one direction: the orders pager used native `disabled`, which
 * Chromium answers by BLURRING the focused button (the jsdom-vs-browser
 * family) — this component carries the `aria-disabled` + click-guard form
 * to every consumer.
 *
 * Uses the `admin` namespace's pager keys; callers outside it would pass
 * their own namespace the day one exists.
 */
export function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number
  totalPages: number
  onPage: (page: number) => void
}) {
  const { t } = useTranslation('admin')

  if (totalPages <= 1) return null

  return (
    <div className="mt-4 flex items-center gap-3 text-sm">
      <Button
        type="button"
        variant="secondary"
        aria-disabled={page <= 1 || undefined}
        onClick={() => {
          if (page > 1) onPage(page - 1)
        }}
      >
        {t('pager.previous')}
      </Button>
      <span className="text-text-muted">{t('pager.position', { page, total: totalPages })}</span>
      <Button
        type="button"
        variant="secondary"
        aria-disabled={page >= totalPages || undefined}
        onClick={() => {
          if (page < totalPages) onPage(page + 1)
        }}
      >
        {t('pager.next')}
      </Button>
    </div>
  )
}
