import { createRefCounter } from './refCounter'

/**
 * Refcount for background inertness — DESIGN_SYSTEM.md §8 obligation 4,
 * the one obligation that exists nowhere in the codebase before this
 * slice. DOM-free: hooks/useBackgroundInert.ts is the only place that sets
 * HTMLElement.inert.
 *
 * The snapshot type is `undefined` because there is nothing to restore.
 * `inert` is applied by this app or not at all — unlike body's overflow,
 * no page state precedes it that could be clobbered. The counter is still
 * needed so the first of two stacked overlays to close does not un-inert
 * the background while the other is still open.
 */
export const inertState = createRefCounter<undefined>()
