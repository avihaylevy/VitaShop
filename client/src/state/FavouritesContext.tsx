import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * Count-only interim state for the header favourites badge, mirroring
 * CartContext. A `Set` keyed by product id, so toggling the same product
 * twice is idempotent rather than double-counting. (ISSUE-059 sweep:
 * product cards have long existed; what is still missing is any way to ADD a
 * favourite — ISSUE-058, owned by MILESTONE-009, which replaces this
 * count-only interim state.)
 */

type FavouritesContextValue = {
  count: number
  isFavourite: (productId: string) => boolean
  toggleFavourite: (productId: string) => void
}

const FavouritesContext = createContext<FavouritesContextValue | null>(null)

export function FavouritesProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set())

  const toggleFavourite = useCallback((productId: string) => {
    setIds((current) => {
      const next = new Set(current)
      if (next.has(productId)) {
        next.delete(productId)
      } else {
        next.add(productId)
      }
      return next
    })
  }, [])

  const isFavourite = useCallback((productId: string) => ids.has(productId), [ids])

  const value = useMemo<FavouritesContextValue>(
    () => ({ count: ids.size, isFavourite, toggleFavourite }),
    [ids, isFavourite, toggleFavourite],
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
