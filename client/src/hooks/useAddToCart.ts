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
/**
 * DEC-073 — the drawer auto-opens only on the FIRST add of a browser session.
 * sessionStorage, not a module variable: the shopper moves between the home
 * page and the catalogue (two mounts of this hook), and the whole point is
 * not asking the same question five times. Exported for tests.
 */
export const DRAWER_SHOWN_SESSION_KEY = 'vitashop:cart-drawer-shown'

function drawerAlreadyShown(): boolean {
  try {
    return window.sessionStorage.getItem(DRAWER_SHOWN_SESSION_KEY) === '1'
  } catch {
    // Storage can be unavailable (privacy mode). Degrade to opening every
    // time — the pre-DEC-073 behaviour — rather than never confirming.
    return false
  }
}

function markDrawerShown(): void {
  try {
    window.sessionStorage.setItem(DRAWER_SHOWN_SESSION_KEY, '1')
  } catch {
    // Same degradation as above; nothing to do.
  }
}

/**
 * The stepper-reset half of the confirmation contract, beside the hook that
 * owns the Promise<boolean> it consumes (review of this diff: the branch had
 * been copied verbatim into ProductCard and ProductDetailsPage). Resets only
 * when the add was confirmed IN FULL; a void-returning handler (tests, the
 * dev showcase) keeps the immediate-reset meaning.
 */
export function resetOnConfirmedAdd(
  confirmation: void | Promise<boolean>,
  reset: () => void,
): void {
  if (confirmation instanceof Promise) {
    void confirmation.then((taken) => {
      if (taken) reset()
    })
  } else {
    reset()
  }
}

export function useAddToCart() {
  const { addItem } = useCart()
  const mountedRef = useRef(true)
  const [announced, setAnnounced] = useState<{ slug: string; count: number } | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  /**
   * 🔴 A REF MIRROR OF `drawerOpen`, because the open decision must NOT live
   * inside the state updater. The first version checked-and-stamped the
   * session flag inside `setDrawerOpen`'s updater — an impure updater, and
   * React's dev StrictMode double-invokes updaters precisely to surface
   * that: the second invocation found the flag already stamped and returned
   * `false`, so the drawer NEVER opened in the running app while every jsdom
   * test (rendered without StrictMode) stayed green. Caught in the browser
   * matrix, fixed by deciding BEFORE setState; the tests now render under
   * StrictMode so this class fails in jsdom too.
   */
  const drawerOpenRef = useRef(false)
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
    // ISSUE-118 — the caller may say HOW MANY (the stepper); one is still
    // the default so every existing call site keeps its meaning. The server
    // clamps regardless (§3.4).
    // Returns whether the server took the add IN FULL (false on transport
    // failure, unmount, a clamped add, or a refused-at-maximum add) — the
    // card's stepper resets only on true, never optimistically, so the
    // shopper's chosen number survives for the retry the drawer invites.
    (slug: string, quantity = 1): Promise<boolean> => {
      const trigger =
        gridRef.current?.querySelector<HTMLElement>(
          `[${ADD_TO_CART_ATTRIBUTE}="${CSS.escape(slug)}"]`,
        ) ?? null

      return addItem(slug, quantity).then((result) => {
        if (!result || !mountedRef.current) return false

        // 🔴 EVERY add is announced — quiet is not silent. The header badge
        // updates from the same committed total.
        setAnnounced({ slug, count: result.cart.totalQuantity })

        /*
         * 🔴 DEC-073 — QUIET RE-ADDS, but ONLY FOR CLEAN ADDS. The drawer
         * auto-opens on the first add of the session; after that, the badge
         * and the announcement carry the confirmation.
         *
         * ⚠️ A CLAMPED OR REFUSED-AT-MAX ADD RE-OPENS IT (review finding,
         * HIGH): the drawer was the ONLY surface on these pages that renders
         * the outcome, so a quiet third click on a 2-in-stock product
         * changed NOTHING and said NOTHING — the announcement even repeats
         * the identical sentence, which a live region does not re-announce.
         * That is verbatim the §7.16 silent loss. "Quiet" means not nagging
         * about successes; it must never mean hiding that the add DID NOT
         * TAKE.
         *
         * D1 stands: this runs AFTER the server confirmed, never before.
         * An add while the drawer is ALREADY open changes content only (D8).
         * ⚠️ Decided HERE, never inside the setState updater — see
         * `drawerOpenRef`'s note for the StrictMode defect that shipped.
         */
        const outcome = result.outcome
        const addDidNotFullyTake =
          outcome.clampedByStock || outcome.clampedByCap || outcome.alreadyAtMaximum || outcome.unchanged
        // 🔴 The confirmation the caller resets on is "the add FULLY took" —
        // review of this diff: returning true for alreadyAtMaximum/unchanged
        // reset the stepper in exactly the case the gate was built for.
        const taken = !addDidNotFullyTake
        if (taken && (drawerAlreadyShown() || drawerOpenRef.current)) return taken
        if (drawerOpenRef.current) return taken
        markDrawerShown()
        // DEC-047-A R1 — the return-focus owner is established only on the
        // closed -> open transition.
        returnFocusRef.current = trigger
        drawerOpenRef.current = true
        setDrawerOpen(true)
        return taken
      })
    },
    [addItem],
  )

  const closeDrawer = useCallback(() => {
    drawerOpenRef.current = false
    setDrawerOpen(false)
  }, [])

  return { handleAddToCart, drawerOpen, closeDrawer, returnFocusRef, gridRef, announced }
}
