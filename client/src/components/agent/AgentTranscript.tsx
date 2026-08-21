import { useTranslation } from 'react-i18next'
import type { RefObject } from 'react'
import { AgentProductCard } from './AgentProductCard'
import { Icon } from '../ui/Icon'
import { LeafIcon } from '../icons'
import { FOCUS_RING } from '../ui/focusRing'
import { LinkButton } from '../ui/LinkButton'
import { mapCatalogProduct } from '../../lib/mapCatalogProduct'
import { handoffToCatalogPath, hasCriteriaHandoff } from '../../lib/agentHandoff'
import {
  describeTurn,
  errorMessageKey,
  isPlainNavigationClick,
  type AgentEntry,
} from '../../lib/agentConversation'
import { useOptionalSession } from '../../state/SessionContext'
import type { MouseEvent } from 'react'
import type { SupportedLanguage } from '../../i18n'

/**
 * MILESTONE-011 Checkpoint B — the transcript, its own component (review:
 * building this subtree inline in the panel made every keystroke — and,
 * worse, every cart update on every page while the drawer was CLOSED —
 * re-map every product card, because Drawer discards its children prop only
 * after they were constructed).
 *
 * role="log": the semantics a conversation transcript actually has — new
 * entries at the end, existing entries immutable — and the role that makes
 * the aria-label REAL (a label on a role-less div is dropped from the
 * accessibility tree; review finding). tabIndex makes the scroll container
 * keyboard-reachable, or earlier turns above the fold would be
 * mouse/AT-only.
 */
export function AgentTranscript({
  entries,
  language,
  onAddToCart,
  onNavigate,
  scrollRef,
  awaiting,
  onSuggestion,
}: {
  entries: AgentEntry[]
  language: SupportedLanguage
  onAddToCart: (slug: string, quantity: number) => void | Promise<boolean>
  /** Called when a link inside the transcript leaves for the page — the panel closes itself. */
  onNavigate: () => void
  scrollRef: RefObject<HTMLDivElement | null>
  /** A turn is in flight — renders the typing indicator (ISSUE-144). */
  awaiting: boolean
  /** An empty-state suggestion chip was pressed; the panel sends it through the one send path. */
  onSuggestion: (text: string) => void
}) {
  const { t } = useTranslation('agent')
  const userName = useOptionalSession()?.firstName ?? null

  // Close-on-navigate rides ONLY the plain click that navigates this tab —
  // a cmd/ctrl/middle click opens a background tab and the conversation the
  // user deliberately kept must stay open (review finding).
  function handleNavigateClick(event: MouseEvent<HTMLAnchorElement>) {
    if (isPlainNavigationClick(event)) onNavigate()
  }

  const suggestionKeys = ['suggestions.s1', 'suggestions.s2', 'suggestions.s3'] as const

  return (
    <div
      ref={scrollRef}
      role="log"
      // 🔴 Explicitly NOT live: role="log" implies polite announcements of
      // every appended subtree, which double-read whole turns (cards
      // included) against the widget's single announcement region — that
      // region is the one voice (review finding). The role stays for the
      // semantics and the accessible name.
      aria-live="off"
      aria-label={t('a11y.conversation')}
      tabIndex={0}
      className="flex-1 overflow-y-auto p-4 focus:outline-none"
    >
      {/* ISSUE-144 — the greeting block. The intro stays in the DOM for the
          conversation's whole life (announce(t('panel.intro')) on reset
          refers to text the eye can find again), but once turns exist it
          tightens from a welcome card to one quiet line. */}
      {/* ISSUE-156: short human copy with real air — a compact greeting
          row and one muted line, never a block of clause-chained ink. */}
      {entries.length === 0 ? (
        <div className="mb-5 flex flex-col gap-3.5 rounded-2xl bg-agent-soft p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-round bg-agent text-white">
              <Icon size={22}>
                <LeafIcon />
              </Icon>
            </span>
            {/* ISSUE-148: the signed-in shopper is greeted BY NAME (bounded
                like the header greeting — no server-side length cap). */}
            <p className="max-w-full truncate font-display text-base font-semibold text-text-ink">
              {userName !== null
                ? t('panel.greetingNamed', { name: userName })
                : t('panel.greeting')}
            </p>
          </div>
          <p className="text-sm leading-7 text-text-muted">{t('panel.intro')}</p>
        </div>
      ) : (
        <p className="mb-4 text-[13px] leading-6 text-text-muted">{t('panel.intro')}</p>
      )}
      {/* The suggestion chips — real starting points a first-time user can
          press instead of composing. They ride the SAME send path as the
          composer (turn budget, announcement, everything), and they leave
          with the first turn. */}
      {entries.length === 0 && (
        <div className="mb-4 flex flex-col gap-2">
          <p className="text-[13px] font-semibold text-text-muted">{t('suggestions.title')}</p>
          <ul className="flex list-none flex-wrap gap-2 p-0">
            {suggestionKeys.map((key) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onSuggestion(t(key))}
                  className={`${FOCUS_RING} rounded-round border border-agent/40 bg-well px-3.5 py-2 text-[13px] font-medium text-agent transition-colors duration-150 ease-standard hover:border-agent hover:bg-agent-soft active:scale-[0.98]`}
                >
                  {t(key)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ol className="flex list-none flex-col gap-5 p-0">
        {entries.map((entry, index) => (
          // Index keys are safe here: the list is append-only, and the only
          // other mutation is a full reset to [].
          <li key={index}>
            {entry.kind === 'user' && (
              <div className="ms-8 rounded-2xl rounded-ee-compact bg-agent-soft p-3.5">
                <p className="text-xs font-bold text-agent-strong">{t('panel.you')}</p>
                <p className="text-sm leading-7 text-text-ink">{entry.text}</p>
              </div>
            )}
            {/* An error entry is a RECORD, not an announcement: the widget's
                status region already spoke it once. role="alert" here made
                every past failure a permanently-mounted assertive region
                that re-announced en masse on a language toggle (review). */}
            {entry.kind === 'error' && errorMessageKey(entry.code) !== null && (
              <p className="text-sm leading-6 text-state-error">
                {t(errorMessageKey(entry.code)!)}
              </p>
            )}
            {entry.kind === 'agent' && (
              <div className="me-8 flex flex-col gap-3">
                <p className="flex items-center gap-1.5 text-xs font-bold text-text-muted">
                  <span
                    aria-hidden="true"
                    className="flex size-5 items-center justify-center rounded-round bg-agent text-white"
                  >
                    <Icon size={12}>
                      <LeafIcon />
                    </Icon>
                  </span>
                  {t('panel.assistant')}
                </p>
                {describeTurn(entry.response, t).map((line, lineIndex) => (
                  <p
                    key={lineIndex}
                    // Frozen server/provider prose keeps the language it was
                    // authored in; marking it keeps a mixed-language
                    // transcript correctly attributed after a toggle.
                    lang={line.frozen ? entry.lang : undefined}
                    dir={line.frozen ? (entry.lang === 'he' ? 'rtl' : 'ltr') : undefined}
                    className={
                      lineIndex === 0 && entry.response.notice !== null
                        ? 'rounded-card border border-border-hairline bg-surface-sunken p-3 text-[13px] leading-5 text-text-ink'
                        : 'text-sm leading-7 text-text-ink'
                    }
                  >
                    {line.text}
                  </p>
                ))}
                {/* REQ-F-077 (Checkpoint C): an empty result offers the
                    handoff — the SAME criteria, carried into /catalog's
                    filter fields via the shared URL contract. A link, not a
                    button: it navigates. It closes the panel on the way.
                    🔴 Rendered only when the path actually CARRIES criteria
                    (review finding: an empty handoff object produced a link
                    promising "these filters" that opened the whole
                    unfiltered catalogue). */}
                {entry.response.emptyResult && hasCriteriaHandoff(entry.response.handoff) && (
                    <LinkButton
                      to={handoffToCatalogPath(entry.response.handoff)}
                      variant="secondary"
                      onClick={handleNavigateClick}
                    >
                      {t('reply.handoff')}
                    </LinkButton>
                  )}
                {entry.response.products.length > 0 && (
                  <>
                    <p className="text-sm font-semibold text-text-ink">{t('reply.products')}</p>
                    <ul className="flex list-none flex-col gap-3 p-0">
                      {entry.response.products.map((dto, productIndex) => (
                        <li key={dto.slug}>
                          <AgentProductCard
                            product={mapCatalogProduct(dto, language)}
                            explanation={entry.response.explanations[productIndex] ?? ''}
                            explanationLang={entry.lang}
                            onAddToCart={onAddToCart}
                            onNavigateClick={handleNavigateClick}
                          />
                        </li>
                      ))}
                    </ul>
                    {/* ISSUE-161 — a SUCCESSFUL turn also lands the shopper
                        on the right PAGE: the same criteria-preserving
                        handoff the empty state always had (the server sends
                        handoff on success too; the client just never
                        rendered it). Same criteria-carrying guard. */}
                    {hasCriteriaHandoff(entry.response.handoff) && (
                        <LinkButton
                          to={handoffToCatalogPath(entry.response.handoff)}
                          variant="secondary"
                          onClick={handleNavigateClick}
                        >
                          {t('reply.handoffBrowse')}
                        </LinkButton>
                      )}
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      {/* ISSUE-144 — the typing indicator. Purely visual (aria-hidden): the
          widget's live region is the one voice for the reply's arrival, and
          the composer's aria-disabled send already carries the in-flight
          state for AT. Dots collapse to static under reduced motion. */}
      {awaiting && (
        <div aria-hidden="true" data-testid="agent-typing" className="mt-4 flex items-center gap-1.5">
          <span className="flex size-5 items-center justify-center rounded-round bg-agent text-white">
            <Icon size={12}>
              <LeafIcon />
            </Icon>
          </span>
          <span className="flex items-center gap-1 rounded-2xl rounded-ss-compact bg-surface-sunken px-3 py-2.5">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                style={{ animationDelay: `${dot * 160}ms` }}
                className="size-1.5 rounded-round bg-agent motion-safe:animate-[agent-typing-dot_1.1s_ease-in-out_infinite]"
              />
            ))}
          </span>
        </div>
      )}
    </div>
  )
}
