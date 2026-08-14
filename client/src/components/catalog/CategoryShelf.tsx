import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { CatalogCategoryDto } from '../../types/catalog'
import { getCategoryTone } from '../../lib/categoryTone'
import { FOCUS_RING } from '../ui/focusRing'

type CategoryShelfProps = {
  categories: readonly CatalogCategoryDto[]
  /** The category slug selected by the current /catalog?category= URL, if any. */
  activeCategorySlug?: string
  className?: string
}

/*
 * ISSUE-056 — the shelf is ONE row at every width: chips never wrap (the
 * list scrolls horizontally inside its own overflow container instead —
 * never the page), and from md up they compact to min-h-9/px-3. Below md
 * the 44px touch target stays. whitespace-nowrap keeps a two-word category
 * from wrapping inside its own chip.
 */
const LINK_CLASS =
  'inline-flex min-h-11 min-w-11 items-center justify-center whitespace-nowrap rounded-compact px-4 text-sm text-text-ink transition-colors duration-150 ease-standard md:min-h-9 md:px-3'

/**
 * Category navigation only — REQ-F-001's six canonical categories plus
 * "all products". Not the filters system: no product counts, no
 * brand/price/stock controls (technical/UI_IMPLEMENTATION_PLAN.md step 6,
 * Slice 6 Checkpoint A). Every item is a real link, never a button, so it
 * works without JS and is a normal Tab stop.
 */
export function CategoryShelf({ categories, activeCategorySlug, className = '' }: CategoryShelfProps) {
  const { t, i18n } = useTranslation('catalog')
  const isAllActive = activeCategorySlug === undefined

  return (
    <nav aria-label={t('categoryShelf.navLabel')} className={className}>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        <li>
          <Link
            to="/catalog"
            aria-current={isAllActive ? 'page' : undefined}
            className={`${FOCUS_RING} ${LINK_CLASS} border border-border-control bg-well ${
              isAllActive ? 'font-semibold underline decoration-2 underline-offset-4' : 'font-medium hover:bg-surface-sunken'
            }`}
          >
            {t('categoryShelf.allProducts')}
          </Link>
        </li>
        {categories.map((category) => {
          const isActive = category.slug === activeCategorySlug
          return (
            <li key={category.slug}>
              <Link
                to={`/catalog?category=${category.slug}`}
                aria-current={isActive ? 'page' : undefined}
                style={{ backgroundColor: getCategoryTone(category.nameHe) }}
                className={`${FOCUS_RING} ${LINK_CLASS} ${
                  isActive ? 'font-semibold underline decoration-2 underline-offset-4' : 'font-medium hover:opacity-80'
                }`}
              >
                {i18n.language === 'he' ? category.nameHe : category.nameEn}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
