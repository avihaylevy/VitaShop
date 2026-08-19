import { useTranslation } from 'react-i18next'
import type { RefObject } from 'react'
import { AgentProductCard } from './AgentProductCard'
import { LinkButton } from '../ui/LinkButton'
import { mapCatalogProduct } from '../../lib/mapCatalogProduct'
import { handoffToCatalogPath } from '../../lib/agentHandoff'
import {
  describeTurn,
  errorMessageKey,
  isPlainNavigationClick,
  type AgentEntry,
} from '../../lib/agentConversation'
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
}: {
  entries: AgentEntry[]
  language: SupportedLanguage
  onAddToCart: (slug: string, quantity: number) => void | Promise<boolean>
  /** Called when a link inside the transcript leaves for the page — the panel closes itself. */
  onNavigate: () => void
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation('agent')

  // Close-on-navigate rides ONLY the plain click that navigates this tab —
  // a cmd/ctrl/middle click opens a background tab and the conversation the
  // user deliberately kept must stay open (review finding).
  function handleNavigateClick(event: MouseEvent<HTMLAnchorElement>) {
    if (isPlainNavigationClick(event)) onNavigate()
  }

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
      <p className="mb-4 text-sm leading-6 text-text-muted">{t('panel.intro')}</p>
      <ol className="flex list-none flex-col gap-4 p-0">
        {entries.map((entry, index) => (
          // Index keys are safe here: the list is append-only, and the only
          // other mutation is a full reset to [].
          <li key={index}>
            {entry.kind === 'user' && (
              <div className="ms-8 rounded-card bg-surface-sunken p-3">
                <p className="text-xs font-bold text-text-muted">{t('panel.you')}</p>
                <p className="text-sm leading-6 text-text-ink">{entry.text}</p>
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
                <p className="text-xs font-bold text-text-muted">{t('panel.assistant')}</p>
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
                        : 'text-sm leading-6 text-text-ink'
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
                {entry.response.emptyResult &&
                  entry.response.handoff !== null &&
                  handoffToCatalogPath(entry.response.handoff) !== '/catalog' && (
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
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
