import commonHe from '../locales/he/common.json'
import commonEn from '../locales/en/common.json'
import layoutHe from '../locales/he/layout.json'
import layoutEn from '../locales/en/layout.json'
import catalogHe from '../locales/he/catalog.json'
import catalogEn from '../locales/en/catalog.json'
import cartHe from '../locales/he/cart.json'
import cartEn from '../locales/en/cart.json'
import authHe from '../locales/he/auth.json'
import authEn from '../locales/en/auth.json'
import ordersHe from '../locales/he/orders.json'
import ordersEn from '../locales/en/orders.json'
import checkoutHe from '../locales/he/checkout.json'
import checkoutEn from '../locales/en/checkout.json'
import adminHe from '../locales/he/admin.json'
import adminEn from '../locales/en/admin.json'
import infoHe from '../locales/he/info.json'
import infoEn from '../locales/en/info.json'
import clubHe from '../locales/he/club.json'
import clubEn from '../locales/en/club.json'
import accountHe from '../locales/he/account.json'
import accountEn from '../locales/en/account.json'

/**
 * The i18next resource map — pure data, no side effects. Extracted from
 * `index.ts` at Slice 10 Checkpoint D so `resources.test.ts` (a
 * filesystem-discovery drift guard) can import it without importing
 * `index.ts`, which calls `applyDocumentDirection()` at module-load time
 * and touches `document` — unavailable under this project's Node-environment
 * Vitest setup (no jsdom).
 *
 * 🔴 No initialization, no document/window access, no
 * `applyDocumentDirection()` call. `index.ts` is the only production
 * consumer.
 */
export const resources = {
  he: {
    common: commonHe,
    layout: layoutHe,
    catalog: catalogHe,
    cart: cartHe,
    auth: authHe,
    orders: ordersHe,
    checkout: checkoutHe,
    admin: adminHe,
    info: infoHe,
    club: clubHe,
    account: accountHe,
  },
  en: {
    common: commonEn,
    layout: layoutEn,
    catalog: catalogEn,
    cart: cartEn,
    auth: authEn,
    orders: ordersEn,
    checkout: checkoutEn,
    admin: adminEn,
    info: infoEn,
    club: clubEn,
    account: accountEn,
  },
} as const

/**
 * The namespace set this resource map registers with i18next, per locale.
 * Derived from `resources` itself — never a separate hand-maintained list —
 * so it can never drift from what `index.ts` actually passes to `i18next.init`.
 */
export const registeredNamespaces = {
  he: Object.keys(resources.he),
  en: Object.keys(resources.en),
} as const
