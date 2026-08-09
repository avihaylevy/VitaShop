import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'

interface CatalogErrorStateProps {
  onRetry: () => void
}

/**
 * Presentational only — Slice 9 Checkpoint B §6. Lifted verbatim from
 * CatalogPage.tsx's prior inline error markup. Carries no error object or
 * message prop — it cannot leak what it never receives (Checkpoint A's
 * rule: no raw error content is ever shown). `onRetry` is the caller's
 * existing `useCatalogData().retry` — clicking it re-triggers the same
 * server request only; this component introduces no local fallback
 * catalogue data and has no fetch of its own. The server remains the
 * source of truth.
 */
export function CatalogErrorState({ onRetry }: CatalogErrorStateProps) {
  const { t } = useTranslation('catalog')

  return (
    <div className="mt-6 flex flex-col items-start gap-3">
      <p className="text-sm text-state-error" role="alert">
        {t('catalogPage.error')}
      </p>
      <Button variant="secondary" onClick={onRetry}>
        {t('catalogPage.retry')}
      </Button>
    </div>
  )
}
