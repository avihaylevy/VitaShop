import { useState, type FormEvent, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
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
  onSend,
  onReset,
  inputRef,
}: {
  locked: boolean
  /** Resolves when the send settles (success or recorded failure). */
  onSend: (message: string) => Promise<void>
  onReset: () => void
  inputRef: RefObject<HTMLInputElement | null>
}) {
  const { t } = useTranslation('agent')
  const [draft, setDraft] = useState('')
  const [inFlight, setInFlight] = useState(false)

  const canSend = !inFlight && !locked && draft.trim() !== ''

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSend) return
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
          className={`${FOCUS_RING} min-w-0 flex-1 rounded-card border border-border-hairline bg-well px-3 py-2 text-sm text-text-ink placeholder:text-text-muted aria-disabled:bg-surface-sunken aria-disabled:text-text-muted`}
        />
        <Button
          type="submit"
          variant="primary"
          aria-disabled={!canSend || undefined}
        >
          {inFlight ? t('panel.sending') : t('panel.send')}
        </Button>
      </div>
    </form>
  )
}
