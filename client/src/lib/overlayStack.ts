/**
 * Which overlay is on top. DOM-free by construction — entries are plain
 * string ids (React useId values), never element references.
 *
 * Escape and the Tab trap are document-level listeners, so with two
 * overlays open both would otherwise fire. Every such handler asks
 * isTopmost() first, and only the top of this stack acts.
 *
 * DESIGN_SYSTEM.md specifies no nested-overlay pattern. This module makes
 * nesting behave correctly if it ever happens; it is not a licence to ship
 * one — a real nested usage is a stop-and-ask (UI_IMPLEMENTATION_PLAN §15).
 *
 * Module-level state is safe here: one document, one stack. It is not
 * React state because the listeners that read it are imperative, and
 * re-rendering on stack changes would serve nothing.
 */

let stack: string[] = []

/**
 * Marks `id` as the topmost overlay. Re-pushing an id already present
 * moves it to the top rather than duplicating it — StrictMode's
 * double-invoked effects must not leave an entry that a single pop cannot
 * clear.
 */
export function push(id: string): void {
  stack = stack.filter((entry) => entry !== id)
  stack.push(id)
}

/** Removes `id` from anywhere in the stack. A no-op if absent. */
export function pop(id: string): void {
  stack = stack.filter((entry) => entry !== id)
}

/**
 * False for an unknown id and for an empty stack, so a handler that
 * somehow outlives its own overlay goes quiet rather than acting on
 * another overlay's behalf.
 */
export function isTopmost(id: string): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id
}

export function depth(): number {
  return stack.length
}

/** Test seam only — nothing in the app clears the stack wholesale. */
export function reset(): void {
  stack = []
}
