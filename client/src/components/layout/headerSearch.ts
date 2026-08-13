/**
 * ISSUE-085 — one rule, shared by both headers.
 *
 * `/catalog` renders its own search field (`CatalogSearchField`), which §10
 * requires to reflect the committed `q` and which routes through the page's
 * own `nextCatalogUrlState` so §5's page-reset rule applies. The header's
 * global `SearchBox` does neither, and side by side the two were identical in
 * markup, placeholder and accessible name — two `role="search"` landmarks with
 * the same name on one page.
 *
 * 🔴 THE HEADER'S FIELD STANDS DOWN, NOT THE PAGE'S. The page's is the one
 * carrying state; replacing it with the header's would mean teaching the
 * header about the catalogue's URL contract.
 *
 * ⚠️ Both `Header` and `MobileHeader` call this. A fix applied to only one of
 * them would leave the duplicate at every width below `md`.
 */
const CATALOG_PATH = '/catalog'

export function shouldRenderHeaderSearch(pathname: string): boolean {
  const path = pathname.split('?')[0]!.replace(/\/+$/, '')
  return path !== CATALOG_PATH
}
