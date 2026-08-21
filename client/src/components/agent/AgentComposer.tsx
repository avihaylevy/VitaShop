import { useState, type FormEvent, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { SendIcon } from '../icons'
import { FOCUS_RING } from '../ui/focusRing'

/**
 * MILESTONE-011 Checkpoint B — the composer, its own component so the draft
 * keystrokes never re-render the transcript (review), and so the
 * async-control rules live in ONE place:
 *
 * 🔴 NOTHING HERE EVER UNMOUNTS. The first version swapped the whole
 * composer for a reset button at the turn limit — the exact
 * "control-that-unmounts-itself" family the project keeps shipping, and it
 * took the user's focus with it mid-flight (review). Now:
 *   · the input stays mounted always; when the conversation is locked it is
 *     readOnly + aria-disabled;
 *   · the send button stays mounted always; in flight or locked it is
 *     aria-disabled (Button's shared look), never `disabled`;
 *   · the lock notice + "New conversation" button render IN ADDITION to the
 *     composer, and the reset handler moves focus BACK TO THE INPUT
 *     deliberately before its own button disappears.
 *
 * One guard: `handleSubmit`'s. The button carries aria-disabled for state
 * and pointer-events; the keyboard path (Enter anywhere in the form) lands
 * in handleSubmit, whose single check owns the decision (review: the same
 * condition used to be written three times).
 */
export function AgentComposer({
  locked,
  awaiting,
  onSend,
  onReset,
  inputRef,
}: {
  locked: boolean
  /** A turn is in flight ANYWHERE (composer or suggestion chip) — the panel owns the flag. */
  awaiting: boolean
  /** Resolves when the send settles (success or recorded failure). */
  onSend: (message: string) => Promise<void>
  onReset: () => void
  inputRef: RefObject<HTMLInputElement | null>
}) {
  const { t } = useTranslation('agent')
  const [draft, setDraft] = useState('')
  const [inFlight, setInFlight] = useState(false)

  // Review fix: `awaiting` covers the chip-initiated turn the composer's
  // own inFlight cannot see — without it, Enter mid-chip-turn double-sent.
  const canSend = !inFlight && !awaiting && !locked && draft.trim() !== ''

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSend) {
      // ISSUE-155 — a press on the not-ready send must DO something
      // visible: the caret lands in the input (the thing actually
      // missing is text). pointer-events are no longer swallowed, so
      // this branch is reachable by mouse as well as Enter.
      // Review fix: not when LOCKED — focusing a readOnly input answers
      // nothing; the New-conversation button above is the real next step.
      if (!locked) inputRef.current?.focus()
      return
    }
    const message = draft.trim()
    setDraft('')
    setInFlight(true)
    try {
      await onSend(message)
    } finally {
      setInFlight(false)
    }
  }

  function handleReset() {
    onReset()
    // 🔴 Deliberate focus move BEFORE this button unmounts with the lock.
    inputRef.current?.focus()
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-border-hairline p-4">
      {locked && (
        <div className="mb-3 flex flex-col gap-2">
          <p className="text-sm text-text-muted">{t('reply.turnLimit')}</p>
          <Button variant="secondary" onClick={handleReset}>
            {t('reply.newConversation')}
          </Button>
        </div>
      )}
      {/* ISSUE-144 — a chat-shaped composer: pill input + a round plum send.
          The send is hand-styled (Button's baked-in rounded-card collides
          with a pill radius at equal specificity) but keeps Button's exact
          aria-disabled discipline: focusable while unavailable, never
          `disabled`, the same sunken look. */}
      <div className="flex items-center gap-2">
        <input
          ref={(node) => {
            inputRef.current = node
          }}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t('panel.placeholder')}
          placeholder={t('panel.placeholder')}
          maxLength={500}
          readOnly={locked}
          aria-disabled={locked || undefined}
          // ISSUE-147's single-frame focus, in the agent's own hue: the
          // border turns plum with a soft halo — no offset outline drawing
          // a second box around the pill (the "doubled" look the user
          // rejected on the search field).
          className="min-w-0 flex-1 rounded-round border border-border-hairline bg-well px-4 py-2.5 text-sm text-text-ink outline-none transition-[border-color,box-shadow] duration-150 ease-standard placeholder:text-text-muted focus-visible:border-agent focus-visible:shadow-[0_0_0_3px_rgb(122_62_107/0.18)] aria-disabled:bg-surface-sunken aria-disabled:text-text-muted motion-reduce:transition-none"
        />
        <button
          type="submit"
          aria-label={inFlight ? t('panel.sending') : t('panel.send')}
          aria-disabled={!canSend || undefined}
          // ISSUE-146: the send must FEEL pressable — always plum (dimmed,
          // never gray, while unavailable), carrying its own elevation,
          // lifting on hover and compressing on press.
          // ISSUE-155: no pointer-events-none — a press on the dimmed state
          // still reaches handleSubmit, which focuses the input as the
          // visible answer. The enabled press compresses hard (scale .88 +
          // strong fill) so a click is unmistakable.
          className={`${FOCUS_RING} relative inline-flex size-11 shrink-0 items-center justify-center rounded-round border border-transparent bg-agent text-white shadow-[0_2px_8px_rgb(122_62_107/0.35)] transition-[background-color,box-shadow,transform] duration-150 ease-standard hover:-translate-y-px hover:bg-agent-strong hover:shadow-[0_5px_14px_rgb(122_62_107/0.45)] active:translate-y-0 active:scale-[0.88] active:bg-agent-strong aria-disabled:bg-agent/40 aria-disabled:shadow-none motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
        >
          {inFlight ? (
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-round border-2 border-current border-t-transparent motion-reduce:animate-none"
            />
          ) : (
            <Icon size={20} className="rtl:-scale-x-100">
              <SendIcon />
            </Icon>
          )}
        </button>
      </div>
    </form>
  )
}
