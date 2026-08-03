/**
 * Focus-order arithmetic. Deliberately DOM-free — this module must stay
 * importable in the `node` test environment, so it never queries an
 * element or calls .focus(). The DOM half (querying a container, moving
 * focus) lives in hooks/useFocusTrap.ts, which is thin precisely because
 * it cannot be unit tested without a dependency DEC-030 defers.
 */

/**
 * Lifted verbatim from the pre-migration MobileMenu so the shipped,
 * already-verified trap behaviour is preserved exactly. Changing this
 * string changes MobileMenu's tab order.
 *
 * Known limitation, unchanged from the original: this is a static
 * selector, so it matches elements that are present but not actually
 * focusable (display:none, visibility:hidden, a closed <details>). No
 * overlay in this codebase renders such content, and the alternative —
 * checkVisibility() per element per keypress — is a DOM concern that
 * belongs in the hook, not here.
 */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Where Tab / Shift+Tab should land, given where focus currently sits.
 *
 * @param currentIndex position of the focused element in the focusable
 *   list, or -1 when focus is outside it (typically on the panel itself,
 *   which carries tabIndex={-1} and so never appears in the list).
 * @param count how many focusable elements the container holds.
 * @param shiftKey true for Shift+Tab.
 * @returns the index to focus, or -1 when there is nothing to focus.
 */
export function nextFocusIndex(currentIndex: number, count: number, shiftKey: boolean): number {
  if (count <= 0) return -1

  // Entering the trap from outside the list: Tab starts at the top,
  // Shift+Tab at the bottom — matching how a browser enters any container.
  if (currentIndex < 0) return shiftKey ? count - 1 : 0

  // + count before the modulo: (0 - 1) % n is -1 in JS, not n - 1.
  return (currentIndex + (shiftKey ? -1 : 1) + count) % count
}
