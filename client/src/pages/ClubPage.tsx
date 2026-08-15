import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { requestClubAction, requestClubStatus } from '../lib/accountApi'
import type { ClubStatus } from '../types/account'
import { Button } from '../components/ui/Button'

/**
 * MILESTONE-012 Checkpoint B / DEC-086 — the club's account-area surface.
 *
 * 🔴 THE PAGE RENDERS STATE AND NEVER PRICES. The 10% figure in the copy is
 * descriptive; every discounted number the shopper sees comes from the
 * cart/checkout DTOs the server computes (§3.4).
 *
 * 🔴 THE ASYNC-CONTROL FAMILY RULES, applied on arrival rather than in a
 * review round: the join/leave button NEVER unmounts on success (it is the
 * same button with a swapped label, so focus stays where the hand is);
 * in-flight presses are ignored via a guard and announced via `loading`
 * (aria-busy), never `disabled` (which would blur the control — the
 * jsdom-vs-Chromium lesson); outcomes are announced from a role=status
 * region that is ALWAYS MOUNTED; failures from an always-mounted
 * role=alert region.
 *
 * 'unauthenticated' cannot ordinarily happen behind RequireAuth — a session
 * that died in between renders the failure state, and the retry round-trips
 * to the same 401, whose screen-level answer is RequireAuth's (the
 * FavouritesPage precedent, verbatim).
 */
export function ClubPage() {
  const { t } = useTranslation('club')
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ready'; club: ClubStatus } | { status: 'failed' }
  >({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  /** The announcement carries its own identity so repeat outcomes re-announce. */
  const [announced, setAnnounced] = useState<{ key: 'joined' | 'left'; id: number } | null>(null)
  const [actionFailed, setActionFailed] = useState(false)

  const controllerRef = useRef<AbortController | null>(null)

  const load = useCallback(async (signal: AbortSignal) => {
    setState({ status: 'loading' })
    const result = await requestClubStatus()
    if (signal.aborted) return
    setState(result.ok ? { status: 'ready', club: result.status } : { status: 'failed' })
  }, [])

  const startLoad = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    void load(controller.signal)
  }, [load])

  useEffect(() => {
    startLoad()
    return () => controllerRef.current?.abort()
  }, [startLoad])

  const toggle = useCallback(async () => {
    if (busy || state.status !== 'ready') return
    const action = state.club.isClubMember ? 'leave' : 'join'
    setBusy(true)
    setActionFailed(false)
    const result = await requestClubAction(action)
    setBusy(false)
    if (!result.ok) {
      setActionFailed(true)
      return
    }
    setState({ status: 'ready', club: result.status })
    setAnnounced((previous) => ({
      key: result.status.isClubMember ? 'joined' : 'left',
      id: (previous?.id ?? 0) + 1,
    }))
  }, [busy, state])

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="heading-page">{t('page.title')}</h1>
      <p className="mt-3 text-text-ink">{t('page.intro')}</p>

      {state.status === 'loading' && <p className="mt-6 text-text-muted">{t('page.loading')}</p>}

      {state.status === 'failed' && (
        <div className="mt-6">
          <p className="text-text-ink">{t('page.loadError')}</p>
          {/* Stays mounted through the retry — the unmount-takes-focus family. */}
          <Button type="button" variant="secondary" className="mt-3" onClick={startLoad}>
            {t('page.retry')}
          </Button>
        </div>
      )}

      {state.status === 'ready' && (
        <div className="mt-6">
          <p className="text-text-ink">
            {state.club.isClubMember ? t('page.statusMember') : t('page.statusNotMember')}
          </p>
          <Button
            type="button"
            variant={state.club.isClubMember ? 'secondary' : 'primary'}
            loading={busy}
            className="mt-4"
            onClick={() => void toggle()}
          >
            {state.club.isClubMember ? t('page.leave') : t('page.join')}
          </Button>
        </div>
      )}

      {/*
        🔴 BOTH regions are ALWAYS MOUNTED — a live region announces on text
        CHANGE only, and one that mounts with its message says nothing. The
        announcement is keyed on an identity that changes per event, so
        join → leave → join re-announces every time.
      */}
      <p role="status" aria-live="polite" className="mt-4 text-sm text-brand-teal">
        {announced ? t(announced.key === 'joined' ? 'page.joined' : 'page.left') : ''}
      </p>
      <p role="alert" className="mt-1 text-sm text-state-error">
        {actionFailed ? t('page.error') : ''}
      </p>
    </main>
  )
}
