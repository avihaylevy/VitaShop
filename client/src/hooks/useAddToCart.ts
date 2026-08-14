import { useCallback, useEffect, useRef, useState } from 'react'
import { useCart } from '../state/CartContext'
import { ADD_TO_CART_ATTRIBUTE } from '../components/catalog/ProductCard'

/**
 * The add-to-cart choreography, extracted at ISSUE-105 so TWO pages can share
 * ONE implementation.
 *
 * 🔴 WHY THIS EXISTS. Checkpoint F4 made the home-page cards navigational
 * precisely so this machinery — the drawer, the return-focus owner, the
 * announcement — would not be written twice. The user then asked to buy from
 * the home page, which is their call to make; the way to honour BOTH is to move
 * the choreography rather than copy it.
 *
 * ⚠️ EVERY RULE BELOW CAME FROM A DEFECT, and they are preserved verbatim from
 * `CatalogPage`, which is where they were earned:
 *
 *   · the trigger is resolved BEFORE the await — after it, focus may have moved
 *     and the grid may have re-rendered
 *   · the lookup is scoped to the caller's OWN grid, keyed by slug — never
 *     document-wide, never by translated text
 *   · the return-focus owner is established ONLY on the closed -> open
 *     transition (DEC-047-A, R1). A later add while the drawer is open changes
 *     CONTENT only (D8): no re-key, no close/reopen, no replayed focus entry
 *   · the announced count is the cart-wide committed total FROM THE RESPONSE,
 *     so the spoken number always matches the header badge
 *   · nothing publishes after unmount
 *
 * 🔴 THE ANNOUNCEMENT IS STORED AS slug + count, NOT AS A RENDERED STRING, so
 * the sentence re-resolves through i18n on a language toggle instead of
 * freezing in the language it was announced in. Resolving the product NAME is
 * the caller's job, because only the caller knows which list the product came
 * from.
 */
export function useAddToCart() {
  const { addItem } = useCart()
  const mountedRef = useRef(true)
  const [announced, setAnnounced] = useState<{ slug: string; count: number } | null>(null)
  const [drawerSlug, setDrawerSlug] = useState<string | null>(null)
  const returnFocusRef = useRef<HTMLElement>(null)
  /** Scopes the return-focus lookup to one grid — see the header. */
  const gridRef = useRef<HTMLDivElement>(null)

  // Set in the effect BODY, not only at ref init, so StrictMode's
  // mount/unmount/remount cycle restores the flag.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handleAddToCart = useCallback(
    (slug: string) => {
      const trigger =
        gridRef.current?.querySelector<HTMLElement>(
          `[${ADD_TO_CART_ATTRIBUTE}="${CSS.escape(slug)}"]`,
        ) ?? null

      void addItem(slug, 1).then((result) => {
        if (!result || !mountedRef.current) return

        setAnnounced({ slug, count: result.cart.totalQuantity })

        setDrawerSlug((current) => {
          if (current === null) returnFocusRef.current = trigger
          return slug
        })
      })
    },
    [addItem],
  )

  const closeDrawer = useCallback(() => setDrawerSlug(null), [])

  return { handleAddToCart, drawerSlug, closeDrawer, returnFocusRef, gridRef, announced }
}
