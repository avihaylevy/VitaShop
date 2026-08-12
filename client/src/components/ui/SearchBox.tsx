import { useId, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { SearchIcon } from '../icons'
import { IconButton } from './IconButton'

type SearchBoxProps = {
  className?: string
}

/**
 * Dominant search field (DESIGN_SYSTEM.md §4/§5). The focus ring lives on
 * the wrapper via `.searchbox:focus-within` (index.css), not on the input —
 * the wrapper is a `<label>`, so clicking anywhere in it focuses the input
 * and the whole control shows one ring. Exactly one search affordance: the
 * submit `IconButton` at the field's trailing edge. There is no separate
 * decorative icon inside the field — an earlier pass had both, which read
 * as two identical search icons side by side. The submit button is a real,
 * semantically distinct control (a `<button type="submit">`, focusable and
 * labelled on its own), not a copy of a decorative glyph.
 *
 * Submitting navigates to `/catalog?q=...`. The catalogue route itself is
 * out of scope for this slice (UI_IMPLEMENTATION_PLAN.md build order step 6)
 * and does not exist yet, so a submit currently lands on no matching route —
 * the field's own state/a11y/submit behaviour is complete regardless.
 */
export function SearchBox({ className = '' }: SearchBoxProps) {
  const { t } = useTranslation('layout')
  const navigate = useNavigate()
  const inputId = useId()
  const [query, setQuery] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = query.trim()
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
