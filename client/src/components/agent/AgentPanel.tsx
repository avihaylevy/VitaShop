import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer } from '../ui/Drawer'
import { AgentTranscript } from './AgentTranscript'
import { AgentComposer } from './AgentComposer'
import { sendAgentMessage } from '../../lib/agentApi'
import { handoffToCatalogPath } from '../../lib/agentHandoff'
import { CatalogApiError } from '../../lib/catalogApi'
import {
  describeTurn,
  errorMessageKey,
  isConversationLocked,
  toWireHistory,
  type AgentEntry,
} from '../../lib/agentConversation'
import type { SupportedLanguage } from '../../i18n'

/**
 * MILESTONE-011 Checkpoint B — the conversation surface (plan §11.3 C2+C5).
 *
 * The CLIENT owns the transcript (DEC-091 O1 — the server stores nothing):
 * entries live in AgentWidget's state, survive panel close, and die with
 * the tab. Each send re-ships the answered history.
 *
 * State discipline (review findings, all three earned):
 *   · every entries write is a FUNCTIONAL update — a captured-array write
 *     once resurrected a transcript the user had already cleared;
 *   · announcements go through the WIDGET's always-mounted region (this
 *     panel's subtree unmounts with the drawer, so a region here missed
 *     any reply that landed after Escape);
 *   · an in-flight request is ABORTED when the panel closes — a reply
 *     nobody will hear is cancelled, not silently appended.
 */
export function AgentPanel({
  open,
  onClose,
  onNavigate,
  entries,
  setEntries,
  announce,
  addConfirmation,
  returnFocusRef,
  onAddToCart,
}: {
  open: boolean
  onClose: () => void
  /**
   * Close-because-a-link-left-for-the-page — distinct from onClose so the
   * widget can announce the navigation from its session-long region
   * (review: an SPA route change says nothing out loud on its own).
   */
  onNavigate: () => void
  entries: AgentEntry[]
  setEntries: Dispatch<SetStateAction<AgentEntry[]>>
  /** The widget's session-long live region. */
  announce: (text: string) => void
  /** The latest add-to-cart confirmation sentence, or null. */
  addConfirmation: string | null
  returnFocusRef: RefObject<HTMLElement | null>
  onAddToCart: (slug: string, quantity: number) => void | Promise<boolean>
}) {
  const { t, i18n } = useTranslation('agent')
  const language: SupportedLanguage = i18n.language === 'he' ? 'he' : 'en'
  const inputRef = useRef<HTMLInputElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const locked = isConversationLocked(entries)

  // 🔴 Closing the panel aborts the in-flight turn. Without this, a reply
  // could land after Escape and silently grow a transcript nobody was told
  // about — including the medical notice, whose whole purpose is to be seen.
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [open])

  async function sendMessage(message: string): Promise<void> {
    setEntries((previous) => [...previous, { kind: 'user', text: message }])
    const history = toWireHistory(entries)
    const abort = new AbortController()
    abortRef.current = abort
    try {
      const response = await sendAgentMessage(message, history, language, abort.signal)
      setEntries((previous) => [...previous, { kind: 'agent', lang: language, response }])
      // The announcement is describeTurn's join — the same lines the
      // transcript renders, notice first (C2a), never a divergent summary.
      const lines = describeTurn(response, t).map((line) => line.text)
      // The handoff is a CONTROL, so it is not a describeTurn line (the
      // transcript renders it as a link, not prose) — but its existence
      // must still be voiced, and the transcript's log region is
      // deliberately non-live. Appended to the announcement only.
      if (
        response.emptyResult &&
        response.handoff !== null &&
        handoffToCatalogPath(response.handoff) !== '/catalog'
      ) {
        lines.push(t('reply.handoff'))
      }
      announce(lines.length > 0 ? lines.join(' ') : t('a11y.responseArrived'))
    } catch (error) {
      if (abort.signal.aborted) {
        // Deliberate close — mark the turn failed (it never got an answer),
        // announce nothing: the user left the conversation.
        setEntries((previous) => markLastUserFailed(previous))
        return
      }
      const code = error instanceof CatalogApiError ? error.code : 'NETWORK_ERROR'
      setEntries((previous) => [...markLastUserFailed(previous), { kind: 'error', code }])
      const key = errorMessageKey(code)
      announce(key !== null ? t(key) : t('reply.turnLimit'))
    } finally {
      if (abortRef.current === abort) abortRef.current = null
      // Scroll the newest turn into view; focus never moved off the input.
      // scrollTop assignment, not scrollTo(): jsdom implements the property
      // but not the method.
      requestAnimationFrame(() => {
        if (transcriptRef.current) {
          transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
        }
      })
    }
  }

  function resetConversation() {
    setEntries([])
    announce(t('panel.intro'))
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t('panel.title')}
      closeLabel={t('panel.close')}
      returnFocusRef={returnFocusRef}
      initialFocusRef={inputRef}
    >
      <div className="flex h-full flex-col">
        <AgentTranscript
          entries={entries}
          language={language}
          onAddToCart={onAddToCart}
          onNavigate={onNavigate}
          scrollRef={transcriptRef}
        />
        {/* The visible add-to-cart confirmation — quiet adds (the drawer
            only auto-opens once per session) must still SHOW somewhere, and
            the header badge is behind this panel's scrim (review). The
            widget's live region carries the audible half. */}
        {addConfirmation !== null && (
          <p className="border-t border-border-hairline px-4 py-2 text-[13px] text-text-muted">
            {addConfirmation}
          </p>
        )}
        <AgentComposer
          locked={locked}
          onSend={sendMessage}
          onReset={resetConversation}
          inputRef={inputRef}
        />
      </div>
    </Drawer>
  )
}

/** Marks the trailing unanswered user turn as failed (kept in the transcript, excluded from the wire history and the turn budget). */
function markLastUserFailed(entries: AgentEntry[]): AgentEntry[] {
  const last = entries[entries.length - 1]
  if (last?.kind !== 'user' || last.failed === true) return entries
  return [...entries.slice(0, -1), { ...last, failed: true }]
}
