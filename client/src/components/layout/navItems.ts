/**
 * Shared between Header (desktop nav row) and MobileMenu (full nav) — both
 * must expose equivalent destinations (DESIGN_SYSTEM.md §5).
 *
 * 🔴 No per-item colour flag. `מבצעים`/`Sales` previously carried a
 * `commerce: true` flag that coloured its resting label with
 * `--state-commerce` — corrected per explicit user instruction, 2026-08-03
 * (DEC-038): a persistent navigation label is not a promotional state.
 * `--state-commerce` is reserved for sale badges, discount labels and
 * product-level promotional UI, not for a permanently-visible nav item.
 * Every item now shares identical rest/hover/active treatment.
 */
export const NAV_ITEMS = [
  { key: 'home', to: '/', end: true },
  { key: 'catalog', to: '/catalog', end: false },
  { key: 'sales', to: '/sales', end: false },
  { key: 'about', to: '/about', end: false },
  { key: 'contact', to: '/contact', end: false },
] as const

export type NavItem = (typeof NAV_ITEMS)[number]
