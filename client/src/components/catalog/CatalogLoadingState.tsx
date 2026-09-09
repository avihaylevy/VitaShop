import { useTranslation } from 'react-i18next'
import { Surface } from '../ui/Surface'
import { VisuallyHidden } from '../ui/VisuallyHidden'
import { GRID_CLASS, type GridTemplate } from './ProductGrid'

const SKELETON_COUNT = 8

/**
 * Presentational only — Slice 9 Checkpoint B §6. Lifted verbatim from
 * CatalogPage.tsx's prior inline loading markup, with one deliberate
 * change: the status text is accessibility-only (sr-only), never visible
 * — Checkpoint B §0/§4. Sighted users see only the skeleton, unchanged.
 * No fetch, no hook beyond translation, no catalogue-state knowledge.
 */
export function CatalogLoadingState({
  capped = false,
  template,
}: { capped?: boolean; template?: GridTemplate } = {}) {
  const { t } = useTranslation('catalog')

  return (
    <>
      <VisuallyHidden as="p" role="status">
        {t('catalogPage.loading')}
      </VisuallyHidden>
      {/* GRID_CLASS, the ready grid's own strings — the skeleton/grid
          parity contract (CatalogPage.responsive.test.tsx pins it for the
          catalog) holds by construction for EVERY template: a page passing
          `capped` or `template` to its ProductGrid passes the same here too,
          or the content snap-reflows the moment it arrives (area-6 review
          finding). The same lookup as ProductGrid, `template` first. */}
      <ul className={GRID_CLASS[template ?? (capped ? 'capped' : 'fluid')]} aria-hidden="true">
        {Array.from({ length: SKELETON_COUNT }, (_, index) => (
          <li key={index}>
            <Surface variant="section" bordered className="flex flex-col gap-3 p-4">
              <div className="aspect-[4/3] w-full animate-pulse rounded-card bg-well motion-reduce:animate-none" />
              <div className="h-4 w-3/4 animate-pulse rounded-compact bg-surface-sunken motion-reduce:animate-none" />
              <div className="h-4 w-1/2 animate-pulse rounded-compact bg-surface-sunken motion-reduce:animate-none" />
              <div className="h-11 w-full animate-pulse rounded-card bg-surface-sunken motion-reduce:animate-none" />
            </Surface>
          </li>
        ))}
      </ul>
    </>
  )
}
