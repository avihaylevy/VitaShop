import { describe, expect, it } from 'vitest'
import { registeredNamespaces } from './resources'

/**
 * Namespace-registration drift guard — Slice 10 Checkpoint D.
 *
 * Proves BIDIRECTIONAL parity between the locale namespace files that
 * actually exist on disk and the namespaces `resources.ts` registers with
 * i18next, for both locales:
 *
 *   A. Filesystem → registration — every on-disk namespace is registered.
 *   B. Registration → filesystem — every registered namespace has a file.
 *   C. Cross-locale parity — he and en expose the same namespace set.
 *   D. Anti-vacuous guard — discovery is proven non-empty; a guard that
 *      silently matches nothing would pass every check above vacuously.
 *
 * DISCOVERY MECHANISM: `import.meta.glob`, empirically proven to resolve
 * correctly under this project's Vitest setup (Vitest runs through Vite's
 * transform pipeline via `client/vite.config.ts`, and `import.meta.glob`
 * is a Vite build-time feature, not a Node runtime one — confirmed working
 * by a standalone probe before writing this suite, not assumed). The
 * `fs.readdirSync` fallback documented in the approved plan was NOT
 * needed. Discovery targets `../locales/{he,en}/*.json` — relative to
 * THIS file's own location (`client/src/i18n/`), matching where the
 * locale directory actually lives (`client/src/locales/`), never a
 * hand-maintained list.
 *
 * 🔴 This file does not duplicate `localeIntegrity.ts`'s validator — it
 * checks a different, unrelated invariant (which namespace FILES exist and
 * are wired up), not locale KEY/placeholder integrity within a namespace.
 */

function namespaceFromGlobKey(key: string): string {
  const file = key.split('/').pop()!
  return file.replace(/\.json$/, '')
}

function discoverDiskNamespaces(): { he: string[]; en: string[] } {
  const heModules = import.meta.glob('../locales/he/*.json', { eager: true })
  const enModules = import.meta.glob('../locales/en/*.json', { eager: true })
  return {
    he: Object.keys(heModules).map(namespaceFromGlobKey),
    en: Object.keys(enModules).map(namespaceFromGlobKey),
  }
}

/**
 * The guard itself: returns every parity violation as a message. An empty
 * array means the four namespace sets (disk he/en, registered he/en) are
 * all consistent with each other. Pure — takes plain string arrays so it
 * can be proven by synthetic mutation below, independent of real disk
 * state or the real `resources.ts` registration.
 */
function diffNamespaces(disk: { he: string[]; en: string[] }, registered: { he: string[]; en: string[] }): string[] {
  const errors: string[] = []
  const diskHe = new Set(disk.he)
  const diskEn = new Set(disk.en)
  const regHe = new Set(registered.he)
  const regEn = new Set(registered.en)

  // A — filesystem → registration
  for (const ns of [...diskHe].sort()) {
    if (!regHe.has(ns)) errors.push(`he: on-disk namespace "${ns}" is not registered`)
  }
  for (const ns of [...diskEn].sort()) {
    if (!regEn.has(ns)) errors.push(`en: on-disk namespace "${ns}" is not registered`)
  }

  // B — registration → filesystem
  for (const ns of [...regHe].sort()) {
    if (!diskHe.has(ns)) errors.push(`he: registered namespace "${ns}" has no locale file on disk`)
  }
  for (const ns of [...regEn].sort()) {
    if (!diskEn.has(ns)) errors.push(`en: registered namespace "${ns}" has no locale file on disk`)
  }

  // C — cross-locale parity (checked on the disk sets — registration
  // parity follows transitively once A and B both hold for both locales,
  // but a direct check catches a symmetric drift, e.g. both locales
  // registering the same wrong extra namespace, that A/B alone would miss)
  for (const ns of [...diskHe].sort()) {
    if (!diskEn.has(ns)) errors.push(`namespace "${ns}" has an he locale file but no en locale file`)
  }
  for (const ns of [...diskEn].sort()) {
    if (!diskHe.has(ns)) errors.push(`namespace "${ns}" has an en locale file but no he locale file`)
  }

  return errors
}

describe('i18n namespace-registration drift guard — the real repository state', () => {
  it('discovery is non-empty (D — anti-vacuous guard)', () => {
    const disk = discoverDiskNamespaces()
    expect(disk.he.length).toBeGreaterThan(0)
    expect(disk.en.length).toBeGreaterThan(0)
    expect(registeredNamespaces.he.length).toBeGreaterThan(0)
    expect(registeredNamespaces.en.length).toBeGreaterThan(0)
  })

  it('every on-disk namespace is registered, and every registered namespace has a file, for both locales (A + B)', () => {
    const disk = discoverDiskNamespaces()
    expect(diffNamespaces(disk, registeredNamespaces)).toEqual([])
  })

  it('he and en expose the same namespace set (C)', () => {
    const disk = discoverDiskNamespaces()
    expect([...disk.he].sort()).toEqual([...disk.en].sort())
    expect([...registeredNamespaces.he].sort()).toEqual([...registeredNamespaces.en].sort())
  })

  it('the current shipped namespace set is exactly admin/auth/common/layout/catalog/cart/orders/checkout/info (confirmation, not the source of truth)', () => {
    // Updated at MILESTONE-006 Checkpoint H (`auth`), MILESTONE-008
    // Checkpoint F0 (`orders`), and 2026-08-15 (`info` — the ISSUE-119
    // About + ISSUE-125 Contact pages). This
    // assertion is DESIGNED to fail on any namespace change — that is its
    // whole job, and updating it is the deliberate acknowledgement the drift
    // guard asks for, not a nuisance to be loosened.
    const disk = discoverDiskNamespaces()
    expect([...disk.he].sort()).toEqual([
      'admin',
      'auth',
      'cart',
      'catalog',
      'checkout',
      'common',
      'info',
      'layout',
      'orders',
    ])
  })
})

describe('i18n namespace-registration drift guard — mutation proofs (synthetic fixtures)', () => {
  const sound = { he: ['common', 'layout'], en: ['common', 'layout'] }

  it('the sound fixture itself reports zero violations', () => {
    expect(diffNamespaces(sound, sound)).toEqual([])
  })

  it('rejects an on-disk namespace missing from registration (Rule A)', () => {
    const disk = { he: ['common', 'layout', 'ghost'], en: ['common', 'layout'] }
    const registered = { he: ['common', 'layout'], en: ['common', 'layout'] }

    const errors = diffNamespaces(disk, registered)
    expect(errors).toContain('he: on-disk namespace "ghost" is not registered')
  })

  it('rejects a registered namespace missing a locale file on disk (Rule B)', () => {
    const disk = { he: ['common', 'layout'], en: ['common', 'layout'] }
    const registered = { he: ['common', 'layout', 'phantom'], en: ['common', 'layout'] }

    const errors = diffNamespaces(disk, registered)
    expect(errors).toContain('he: registered namespace "phantom" has no locale file on disk')
  })

  it('rejects a registered namespace missing from only ONE locale directory (Rule B, single-locale drift)', () => {
    const disk = { he: ['common', 'layout'], en: ['common', 'layout'] }
    const registered = { he: ['common', 'layout'], en: ['common', 'layout', 'phantom'] }

    const errors = diffNamespaces(disk, registered)
    expect(errors).toContain('en: registered namespace "phantom" has no locale file on disk')
    expect(errors.some((message) => message.startsWith('he:'))).toBe(false)
  })

  it('rejects an he/en namespace mismatch (Rule C)', () => {
    const disk = { he: ['common', 'layout', 'extra'], en: ['common', 'layout'] }
    const registered = { he: ['common', 'layout', 'extra'], en: ['common', 'layout'] }

    const errors = diffNamespaces(disk, registered)
    expect(errors).toContain('namespace "extra" has an he locale file but no en locale file')
  })

  it('empty discovery reports zero violations from diffNamespaces alone — proving the SEPARATE non-emptiness assertion (D) is load-bearing, not redundant', () => {
    const empty = { he: [], en: [] }
    // A guard that only checked diffNamespaces() would pass vacuously on
    // total discovery failure — this is exactly why "discovery is
    // non-empty" is asserted as its own, independent test above.
    expect(diffNamespaces(empty, empty)).toEqual([])
  })
})
