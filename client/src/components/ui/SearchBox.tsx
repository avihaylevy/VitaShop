import { useEffect, useId, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { SearchIcon } from '../icons'
import { Icon } from './Icon'
import { FOCUS_RING } from './focusRing'
import {
  buildCatalogSearchParams,
  nextCatalogUrlState,
  parseCatalogUrlState,
} from '../../features/catalog/catalogUrlState'

type SearchBoxProps = {
  className?: string
}

/**
 * THE search field — one, beside the logo, on every page (ISSUE-110; the
 * user: "השורת חיפוש צריכה להיות באותו מקום ליד הלוגו"). This SUPERSEDES
 * ISSUE-085's resolution, which stood the header field down on /catalog in
 * favour of a page-local `CatalogSearchField`; the user asked for the
 * opposite, so the header field absorbed that component's /catalog contract
 * and both the page field and the stand-down rule are deleted.
 *
 * The /catalog binding, verbatim from the absorbed component:
 *   · the field REFLECTS the committed `q` (§10) — a draft synced from the
 *     URL, so back/forward and canonicalizing navigations win over typing
 *   · submit routes through `nextCatalogUrlState`, so §5's page-reset rule
 *     applies and every other committed parameter is preserved
 *   · typing never navigates; an emptied submit clears `q` (the same
 *     presence rule `buildCatalogSearchParams` uses)
 * Anywhere else, submit navigates to /catalog?q=… exactly as before.
 *
 * Dominant search field (DESIGN_SYSTEM.md §4/§5). The focus ring lives on
 * the wrapper via `.searchbox:focus-within` (index.css), not on the input —
 * the wrapper is a `<label>`, so clicking anywhere in it focuses the input
 * and the whole control shows one ring. Exactly one search affordance: the
 * submit `IconButton` at the field's trailing edge, a real labelled
 * `<button type="submit">`.
 */
const CATALOG_PATH = '/catalog'

export function SearchBox({ className = '' }: SearchBoxProps) {
  const { t } = useTranslation('layout')
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const inputId = useId()

  const onCatalog = location.pathname.replace(/\/+$/, '') === CATALOG_PATH
  const committedQ = onCatalog ? (searchParams.get('q') ?? '') : ''
  const [query, setQuery] = useState(committedQ)

  // The URL always wins: re-sync the draft whenever the committed q changes
  // (back/forward, a cleared filter set, arriving on /catalog, leaving it).
  useEffect(() => {
    setQuery(committedQ)
  }, [committedQ])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = query.trim()
    if (onCatalog) {
      const urlState = parseCatalogUrlState(searchParams)
      setSearchParams(
        buildCatalogSearchParams(
          nextCatalogUrlState(urlState, { q: trimmed.length > 0 ? trimmed : undefined }),
        ),
      )
      return
    }
    navigate(trimmed ? `/catalog?q=${encodeURIComponent(trimmed)}` : '/catalog')
  }

  return (
    <form role="search" onSubmit={handleSubmit} className={`w-full max-w-xl ${className}`}>
      <label
        htmlFor={inputId}
        className="searchbox flex h-11 w-full items-center gap-2 rounded-card border border-border-control bg-well ps-3 pe-1"
      >
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('search.placeholder')}
          aria-label={t('search.label')}
          className="h-full min-w-0 flex-1 bg-transparent text-base text-text-ink outline-none placeholder:text-text-muted"
        />
        {/* ISSUE-159 — hand-styled, not IconButton: the primitive's square
            rounded-card hover box broke the pill's geometry (the user's
            screenshot). A ROUND tint that matches the pill's own curvature,
            teal-soft instead of gray, with a light press squeeze. Still a
            44px target (size-11 hit area), radius collision avoided the
            documented way (no equal-specificity override of rounded-card). */}
        <button
          type="submit"
          aria-label={t('search.submit')}
          // ISSUE-169: the tint returned to the STANDARD control hover
          // (surface-sunken, every other button's color) — the round shape
          // and fitted size stay, only the foreign teal wash left.
          // The user's twelfth list (2026-08-21): the size-11 tint circle was
          // CLIPPED by the pill (h-11 minus its 1px borders leaves 42px). The
          // visible background moved to an inner size-9 span so it fits the
          // pill with room to spare; the button keeps the full 44px hit area.
          className={`${FOCUS_RING} group inline-flex size-11 shrink-0 items-center justify-center rounded-round text-text-muted`}
        >
          <span className="inline-flex size-9 items-center justify-center rounded-round transition-[background-color,color,transform] duration-150 ease-standard group-hover:bg-surface-sunken group-hover:text-text-ink group-active:scale-[0.92] motion-reduce:transition-none">
            <Icon size={18}>
              <SearchIcon />
            </Icon>
          </span>
        </button>
      </label>
    </form>
  )
}
