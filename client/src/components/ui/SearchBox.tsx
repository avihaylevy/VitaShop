import { useEffect, useId, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { SearchIcon } from '../icons'
import { IconButton } from './IconButton'
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
        <IconButton
          type="submit"
          icon={<SearchIcon />}
          aria-label={t('search.submit')}
          variant="ghost"
          className="shrink-0"
        />
      </label>
    </form>
  )
}
