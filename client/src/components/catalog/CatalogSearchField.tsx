import { useEffect, useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchIcon } from '../icons'
import { IconButton } from '../ui/IconButton'

type CatalogSearchFieldProps = {
  /** The committed `q` from the URL — the single source of truth (§5). */
  value: string
  /** Called on submit only. Typing never navigates (§5: "typing does not" push). */
  onSubmit: (query: string) => void
  className?: string
}

/**
 * MILESTONE-005 Checkpoint I — the catalogue page's own search field (§10:
 * "`SearchBox` reused; on `/catalog` it must reflect the current `q` rather
 * than starting empty").
 *
 * 🔴 Why this is not literally `ui/SearchBox`: that component owns an
 * uncontrolled internal query that always starts empty and navigates to
 * `/catalog?q=…` itself. On `/catalog` both behaviours are wrong — the field
 * must show the `q` already in the URL, and navigation must go through the
 * page's own `nextCatalogUrlState` so the §5 page-reset rule applies. The
 * markup, classes, focus-ring mechanism (`.searchbox:focus-within`), single
 * submit affordance and `layout:search.*` translation keys are the SAME as
 * `SearchBox`'s — this is the header control's `/catalog` binding, not a
 * second search design. `SearchBox` itself is untouched and still ships in
 * the header.
 *
 * The local state is a DRAFT of the URL's `q`, not a mirror of query state:
 * it exists only so typing does not navigate per keystroke. It is re-synced
 * whenever the committed `value` changes (back/forward, a cleared filter set,
 * a canonicalizing navigation), so the URL always wins.
 */
export function CatalogSearchField({ value, onSubmit, className = '' }: CatalogSearchFieldProps) {
  const { t } = useTranslation('layout')
  const inputId = useId()
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(draft.trim())
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
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('search.placeholder')}
          aria-label={t('search.label')}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-text-ink outline-none placeholder:text-text-muted"
        />
        <IconButton type="submit" icon={<SearchIcon />} aria-label={t('search.submit')} variant="ghost" className="shrink-0" />
      </label>
    </form>
  )
}
