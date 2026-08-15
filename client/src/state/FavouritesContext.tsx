import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { addFavourite, fetchFavourites, removeFavourite } from '../lib/favouritesApi'
import { useSession } from './SessionContext'

/**
 * ISSUE-115 / REQ-F-034 — REAL favourites, replacing the count-only interim
 * state that stood here since the header badge shipped (ISSUE-058's
 * dead-end: a nav entry to a list nothing could add to).
 *
 * 🔴 SERVER-CONFIRMED, NEVER OPTIMISTIC — the same rule the cart earned at
 * DEC-047 D1: the set updates when the server says so, and a failure leaves
 * the heart exactly as it was.
 *
 * 🔴 A10 — the ACTION is gated, never the surface. A guest browsing the
 * catalogue sees the hearts; pressing one returns 'auth-required' and the
 * caller navigates to /login. No login wall in front of the catalogue.
 *
 * The context carries the SLUG SET (hearts + badge). The favourites PAGE
 * fetches its own full card list — pages own their data; the context owns
 * the shared, cheap projection.
 */

export type FavouriteToggleResult = 'added' | 'removed' | 'auth-required' | 'failed' | 'pending'

type FavouritesContextValue = {
  /** Header badge — the number of favourited products. */
  count: number
  isFavourite: (slug: string) => boolean
  toggle: (slug: string) => Promise<FavouriteToggleResult>
  /**
   * Replaces the whole set from a caller's own successful fetch of the same
   * endpoint (the favourites PAGE). One server answer feeds BOTH consumers,
   * so a failed provider hydration can no longer contradict a page that just
   * received the list (review of ab8e374: the page filtered its items
   * through this set and rendered "no favourites" over twelve of them).
   */
  replaceAll: (slugs: Iterable<string>) => void
}

const FavouritesContext = createContext<FavouritesContextValue | null>(null)

export function FavouritesProvider({ children }: { children: ReactNode }) {
  const { status } = useSession()
  const { t } = useTranslation('catalog')
  const [slugs, setSlugs] = useState<ReadonlySet<string>>(new Set())
  /**
   * 🔴 ONE app-wide failure announcement (§7.16 — a failed toggle must be
   * SAID). The region lives HERE, always mounted, because a live region per
   * heart would be one per card; and because a failure never unmounts the
   * pressed card, the polite announcement always lands. Cleared at press
   * time so consecutive identical failures still produce a text CHANGE
   * (identical text is not re-announced by a live region).
   */
  const [failureAnnouncement, setFailureAnnouncement] = useState(false)
  useEffect(() => {
    // The region lives at the app ROOT, so without this the failure text
    // would sit in every later page's reading order for the whole session
    // (review of this diff). Clearing text does not retract the polite
    // announcement already made; no user action depends on the text staying.
    if (!failureAnnouncement) return
    const timer = setTimeout(() => setFailureAnnouncement(false), 10000)
    return () => clearTimeout(timer)
  }, [failureAnnouncement])
  /**
   * 🔴 ONE WRITE IN FLIGHT PER SLUG. `wasFavourite` is decided at press
   * time; a second press racing the first would read the same pre-commit
   * set and fire the SAME direction again (two PUTs where the shopper
   * meant add-then-remove — review of ab8e374). The guard turns the
   * second press into an explicit 'pending' no-op instead.
   */
  const inFlightRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    // 🔴 Three-state session (SessionContext): only a KNOWN guest empties
    // the set. During 'loading' nothing is fetched and nothing is cleared —
    // hydration waits for the answer instead of guessing it.
    if (status === 'guest') {
      setSlugs(new Set())
      return
    }
    if (status !== 'authenticated') return
    const controller = new AbortController()
    void fetchFavourites(controller.signal).then((result) => {
      if (controller.signal.aborted) return
      // A failed hydration leaves an empty set — hearts render unfilled and
      // the first toggle still round-trips truthfully. The favourites page
      // repairs it via replaceAll when its own fetch succeeds.
      if (result.ok) setSlugs(new Set(result.items.map((item) => item.slug)))
    })
    return () => controller.abort()
  }, [status])

  const isFavourite = useCallback((slug: string) => slugs.has(slug), [slugs])

  const toggle = useCallback(
    async (slug: string): Promise<FavouriteToggleResult> => {
      // 🔴 Only a KNOWN guest is redirected. While the session probe is
      // still in flight ('loading') the write is ATTEMPTED — the cookie
      // decides, and a real guest comes back 401 → 'auth-required'. The
      // old `!isSignedIn` check bounced signed-in users to /login when
      // they pressed a heart before the probe resolved (review of ab8e374).
      if (status === 'guest') return 'auth-required'
      if (inFlightRef.current.has(slug)) return 'pending'
      inFlightRef.current.add(slug)
      setFailureAnnouncement(false)
      try {
        const wasFavourite = slugs.has(slug)
        const result = wasFavourite ? await removeFavourite(slug) : await addFavourite(slug)
        if (result === 'unauthenticated') return 'auth-required'
        if (result !== 'ok') {
          setFailureAnnouncement(true)
          return 'failed'
        }
        setSlugs((previous) => {
          const next = new Set(previous)
          if (wasFavourite) next.delete(slug)
          else next.add(slug)
          return next
        })
        return wasFavourite ? 'removed' : 'added'
      } finally {
        inFlightRef.current.delete(slug)
      }
    },
    [status, slugs],
  )

  const replaceAll = useCallback((next: Iterable<string>) => {
    setSlugs(new Set(next))
  }, [])

  const value = useMemo<FavouritesContextValue>(
    () => ({ count: slugs.size, isFavourite, toggle, replaceAll }),
    [slugs, isFavourite, toggle, replaceAll],
  )

  return (
    <FavouritesContext.Provider value={value}>
      {children}
      {/* The one always-mounted failure region — see the note on the state. */}
      <span role="status" className="sr-only">
        {failureAnnouncement ? t('favourite.failed') : ''}
      </span>
    </FavouritesContext.Provider>
  )
}

export function useFavourites(): FavouritesContextValue {
  const context = useContext(FavouritesContext)
  if (!context) {
    throw new Error('useFavourites must be used within a FavouritesProvider')
  }
  return context
}
