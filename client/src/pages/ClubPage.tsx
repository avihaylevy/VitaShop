import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { requestClubAction, requestClubStatus } from '../lib/accountApi'
import { useCartRefresh } from '../state/CartContext'
import type { ClubStatus } from '../types/account'
import { Button } from '../components/ui/Button'
import { CenterDialog } from '../components/ui/CenterDialog'
import { FOCUS_RING } from '../components/ui/focusRing'

/**
 * MILESTONE-012 Checkpoint B / DEC-086 — the club's account-area surface.
 * DEC-097 (2026-08-21, the user approving the proposed flow for
 * ISSUE-170/171) replaces the one-click toggle with a FORMAL process:
 * joining opens a dialog — the benefits said plainly, a terms line, and an
 * EXPLICIT consent checkbox gating the confirm; leaving opens its own
 * confirm dialog. The membership itself still flips through the same
 * idempotent server action.
 *
 * 🔴 THE PAGE RENDERS STATE AND NEVER PRICES. The 10% figure in the copy is
 * descriptive; every discounted number the shopper sees comes from the
 * cart/checkout DTOs the server computes (§3.4).
 *
 * 🔴 THE ASYNC-CONTROL FAMILY RULES: the opener buttons never unmount on
 * success (same control, state-swapped label); the dialog's confirm is
 * aria-disabled (never `disabled`) while unconsented or in flight; the
 * dialog closes AFTER the action settles and CenterDialog returns focus to
 * the opener via returnFocusRef; SUCCESS is announced from the page's
 * always-mounted status region (the dialog is gone by then), while a
 * FAILURE — which keeps the dialog open — is voiced from an always-mounted
 * alert region INSIDE the dialog, because Modal inerts #root and an inert
 * live region on the page is never spoken (hundred-second pass review).
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
  /** DEC-097 — which formal dialog is open, and the join dialog's consent. */
  const [dialog, setDialog] = useState<'join' | 'leave' | null>(null)
  const [consented, setConsented] = useState(false)
  const openerRef = useRef<HTMLButtonElement>(null)
  /**
   * Membership changes what the CART shows (clubMember + discounted
   * figures ride the cart DTO), and the header badge reads that context —
   * without this refresh the badge and drawer stay stale until an
   * unrelated cart mutation. Found in the hundred-second pass review.
   */
  const refreshCart = useCartRefresh()

  /** ONE close-and-reset for the join dialog — its three exits shared two
      copies of this pair before the review caught them drifting-prone. */
  const closeJoinDialog = useCallback(() => {
    setDialog(null)
    setConsented(false)
  }, [])

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

  const act = useCallback(
    async (action: 'join' | 'leave') => {
      if (busy || state.status !== 'ready') return
      setBusy(true)
      setActionFailed(false)
      const result = await requestClubAction(action)
      setBusy(false)
      if (!result.ok) {
        // The failure is voiced from the PAGE's alert region; the dialog
        // stays open so the confirm remains under the shopper's hand.
        setActionFailed(true)
        return
      }
      setState({ status: 'ready', club: result.status })
      setAnnounced((previous) => ({
        key: result.status.isClubMember ? 'joined' : 'left',
        id: (previous?.id ?? 0) + 1,
      }))
      // Close AFTER the settle — CenterDialog returns focus to the opener.
      closeJoinDialog()
      // The badge and the drawer read the cart DTO's clubMember; re-read it
      // so the membership change is visible immediately (fire-and-forget —
      // the page's own state is already correct).
      void refreshCart()
    },
    [busy, state, closeJoinDialog, refreshCart],
  )

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
            ref={openerRef}
            type="button"
            variant={state.club.isClubMember ? 'secondary' : 'primary'}
            className="mt-4"
            onClick={() => setDialog(state.club.isClubMember ? 'leave' : 'join')}
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
      {/*
        ⚠️ Page-level copy renders only when NO dialog is open (a failure
        that outlived its dialog). While one is open, the audible copy lives
        INSIDE it — Modal inerts #root, and an inert live region says
        nothing; two visible copies at once would also double-render.
      */}
      <p role="alert" className="mt-1 text-sm text-state-error">
        {actionFailed && dialog === null ? t('page.error') : ''}
      </p>

      {/* DEC-097 — the formal JOIN: benefits, the terms line, explicit consent. */}
      <CenterDialog
        open={dialog === 'join'}
        onClose={closeJoinDialog}
        title={t('joinDialog.title')}
        returnFocusRef={openerRef}
      >
        <div className="flex flex-col gap-4 p-5">
          <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm leading-6 text-text-ink">
            <li>{t('joinDialog.benefit1')}</li>
            <li>{t('joinDialog.benefit2')}</li>
            <li>{t('joinDialog.benefit3')}</li>
          </ul>
          {/* The terms LINK sits beside the consent row, never inside the
              label (the ISSUE-140 nested-interactive lesson). */}
          <label className="flex min-h-11 items-center gap-2 text-sm text-text-ink">
            <input
              type="checkbox"
              checked={consented}
              onChange={(event) => setConsented(event.target.checked)}
              className={`${FOCUS_RING} size-4 shrink-0 accent-brand-teal`}
            />
            <span>{t('joinDialog.consent')}</span>
          </label>
          <p className="text-xs text-text-muted">
            <Link
              to="/terms"
              target="_blank"
              className={`${FOCUS_RING} rounded-compact text-brand-teal underline`}
            >
              {t('joinDialog.termsLink')}
            </Link>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              loading={busy}
              aria-disabled={!consented || busy || undefined}
              onClick={() => {
                if (!consented || busy) return
                void act('join')
              }}
            >
              {t('joinDialog.confirm')}
            </Button>
            <Button type="button" variant="secondary" onClick={closeJoinDialog}>
              {t('joinDialog.cancel')}
            </Button>
          </div>
          {/*
            🔴 THE FAILURE IS VOICED FROM INSIDE THE DIALOG. The page's alert
            region sits in #root, which Modal makes INERT while this dialog is
            open — a message written there is removed from the accessibility
            tree and never spoken. The dialog portals to document.body, so
            this region is the one assistive technology can still hear.
            Always mounted (empty until a failure) so the announcement is a
            TEXT CHANGE, which is what a live region watches.
          */}
          <p role="alert" className="text-sm text-state-error">
            {actionFailed ? t('page.error') : ''}
          </p>
        </div>
      </CenterDialog>

      {/* DEC-097 — leaving is confirmed, never one accidental click. */}
      <CenterDialog
        open={dialog === 'leave'}
        onClose={() => setDialog(null)}
        title={t('leaveDialog.title')}
        returnFocusRef={openerRef}
      >
        <div className="flex flex-col gap-4 p-5">
          <p className="text-sm leading-6 text-text-ink">{t('leaveDialog.body')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              loading={busy}
              aria-disabled={busy || undefined}
              onClick={() => {
                if (busy) return
                void act('leave')
              }}
            >
              {t('leaveDialog.confirm')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              {t('leaveDialog.cancel')}
            </Button>
          </div>
          {/* Same inert reasoning as the join dialog's region above. */}
          <p role="alert" className="text-sm text-state-error">
            {actionFailed ? t('page.error') : ''}
          </p>
        </div>
      </CenterDialog>
    </main>
  )
}
