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
/**
 * 🔴 ISSUE-066, fixed 2026-08-12: `sales`, `about` and `contact` were REMOVED.
 *
 * All three declared a route the router does not, and there was no catch-all,
 * so clicking any of them rendered an EMPTY page — header, footer, nothing
 * between — in both languages and in both the desktop header and the mobile
 * menu.
 *
 * 🔴 THE FIX IS DELETION, NOT THREE NEW PAGES. The specification was checked
 * (2026-08-12) and requires none of them; promotions appear only as REQ-F-062,
 * an ADMIN capability under MILESTONE-010. Building pages the spec does not ask
 * for would be inventing scope to justify a nav item.
 *
 * ⚠️ Their i18n keys were deleted from both locales in the same change. The
 * locale-integrity suite is what names an orphan, so the keys cannot outlive
 * the items unnoticed.
 *
 * A `path="*"` route now exists regardless (see `App.tsx`), so an unknown URL
 * says "not found" instead of rendering blank chrome.
 */
/**
 * 🔄 ISSUE-119 + ISSUE-125 (2026-08-15): `about` and `contact` RETURN — this
 * time WITH their routes and pages (the ISSUE-066 deletion above was about
 * nav items pointing at nothing; the user has since asked for both pages
 * explicitly, superseding DEC-075's אודות deferral). `sales` stays gone.
 */
export const NAV_ITEMS = [
  { key: 'home', to: '/', end: true },
  { key: 'catalog', to: '/catalog', end: false },
  { key: 'about', to: '/about', end: true },
  { key: 'contact', to: '/contact', end: true },
] as const

export type NavItem = (typeof NAV_ITEMS)[number]
