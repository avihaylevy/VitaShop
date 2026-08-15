import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
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

export type FavouriteToggleResult = 'added' | 'removed' | 'auth-required' | 'failed'

type FavouritesContextValue = {
  /** Header badge — the number of favourited products. */
  count: number
  isFavourite: (slug: string) => boolean
  toggle: (slug: string) => Promise<FavouriteToggleResult>
}

const FavouritesContext = createContext<FavouritesContextValue | null>(null)

export function FavouritesProvider({ children }: { children: ReactNode }) {
  const { isSignedIn } = useSession()
  const [slugs, setSlugs] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (!isSignedIn) {
      // Sign-out (or a guest session): the set empties with the identity.
      setSlugs(new Set())
      return
    }
    const controller = new AbortController()
    void fetchFavourites(controller.signal).then((result) => {
      if (controller.signal.aborted) return
      // A failed hydration leaves an empty set — hearts render unfilled and
      // the first toggle still round-trips truthfully.
      if (result.ok) setSlugs(new Set(result.items.map((item) => item.slug)))
    })
    return () => controller.abort()
  }, [isSignedIn])

  const isFavourite = useCallback((slug: string) => slugs.has(slug), [slugs])

  const toggle = useCallback(
    async (slug: string): Promise<FavouriteToggleResult> => {
      if (!isSignedIn) return 'auth-required'
      const wasFavourite = slugs.has(slug)
      const result = wasFavourite ? await removeFavourite(slug) : await addFavourite(slug)
      if (result === 'unauthenticated') return 'auth-required'
      if (result !== 'ok') return 'failed'
      setSlugs((previous) => {
        const next = new Set(previous)
        if (wasFavourite) next.delete(slug)
        else next.add(slug)
        return next
      })
      return wasFavourite ? 'removed' : 'added'
    },
    [isSignedIn, slugs],
  )

  const value = useMemo<FavouritesContextValue>(
    () => ({ count: slugs.size, isFavourite, toggle }),
    [slugs, isFavourite, toggle],
  )

  return <FavouritesContext.Provider value={value}>{children}</FavouritesContext.Provider>
}

export function useFavourites(): FavouritesContextValue {
  const context = useContext(FavouritesContext)
  if (!context) {
    throw new Error('useFavourites must be used within a FavouritesProvider')
  }
  return context
}
