import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CATEGORY_TONE,
  CATEGORY_TONE_STRONG,
  getCategoryTone,
  getCategoryToneStrong,
} from './categoryTone'

/**
 * Explicit expectation, independent of categoryTone.ts's internals — this
 * must match design/DESIGN_SYSTEM.md §1 exactly, not be derived from the
 * module under test, so a real mapping regression cannot hide behind a
 * matching re-export.
 */
const EXPECTED_TONES: Readonly<Record<string, string>> = {
  ויטמינים: 'var(--tone-vitamins)',
  מינרלים: 'var(--tone-minerals)',
  'אומגה ושומנים': 'var(--tone-omega)',
  'חלבונים ואבקות': 'var(--tone-proteins)',
  פרוביוטיקה: 'var(--tone-probiotics)',
  'צמחי מרפא': 'var(--tone-herbs)',
}

// DEC-081: the near-white page ground would swallow a page-coloured
// fallback card, so the fallback moved to the sunken surface.
const FALLBACK_TONE = 'var(--surface-sunken)'

/** Fresh module instance -> fresh warnedUnmappedCategories Set, without a test-only reset export. */
async function loadFreshGetCategoryTone() {
  vi.resetModules()
  const mod = await import('./categoryTone')
  return mod.getCategoryTone
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('getCategoryTone', () => {
  it('maps every approved Hebrew category to its exact approved tone token', () => {
    for (const [category, expectedTone] of Object.entries(EXPECTED_TONES)) {
      expect(getCategoryTone(category)).toBe(expectedTone)
    }
  })

  it('does not warn for known categories', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('DEV', true)

    for (const category of Object.keys(EXPECTED_TONES)) {
      getCategoryTone(category)
    }

    expect(warn).not.toHaveBeenCalled()
  })

  it('returns the approved fallback for an unknown category', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('DEV', false)

    expect(getCategoryTone('קטגוריה-לא-קיימת-fallback')).toBe(FALLBACK_TONE)

    warn.mockRestore()
  })

  it('warns exactly once for repeated use of the same unknown category', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('DEV', true)
    const freshGetCategoryTone = await loadFreshGetCategoryTone()

    freshGetCategoryTone('קטגוריה-לא-קיימת-חוזרת')
    freshGetCategoryTone('קטגוריה-לא-קיימת-חוזרת')
    freshGetCategoryTone('קטגוריה-לא-קיימת-חוזרת')

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('warns once per distinct unknown category', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('DEV', true)
    const freshGetCategoryTone = await loadFreshGetCategoryTone()

    freshGetCategoryTone('קטגוריה-לא-קיימת-א')
    freshGetCategoryTone('קטגוריה-לא-קיימת-ב')
    freshGetCategoryTone('קטגוריה-לא-קיימת-א')

    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('emits no warning in production mode, but still returns the fallback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('DEV', false)
    const freshGetCategoryTone = await loadFreshGetCategoryTone()

    const result = freshGetCategoryTone('קטגוריה-לא-קיימת-פרודקשן')

    expect(result).toBe(FALLBACK_TONE)
    expect(warn).not.toHaveBeenCalled()
  })

  it('includes the unknown category name in the warning text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('DEV', true)
    const freshGetCategoryTone = await loadFreshGetCategoryTone()

    freshGetCategoryTone('קטגוריה-לא-קיימת-מזוהה')

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('קטגוריה-לא-קיימת-מזוהה')
  })
})

/**
 * DEC-106 — the strong level. What is pinned: the two maps cover the SAME
 * six categories (a category added to one and not the other would give a
 * chip and its card different hue families silently), every strong value
 * points at its own -strong token, and the fallback contract matches
 * getCategoryTone's.
 */
describe('getCategoryToneStrong (DEC-106)', () => {
  it('covers exactly the same categories as the soft map', () => {
    expect(Object.keys(CATEGORY_TONE_STRONG).sort()).toEqual(Object.keys(CATEGORY_TONE).sort())
  })

  it('every strong value is the -strong token of a tone variable', () => {
    for (const value of Object.values(CATEGORY_TONE_STRONG)) {
      expect(value).toMatch(/^var\(--tone-[a-z]+-strong\)$/)
    }
  })

  it('an unmapped category falls back to the sunken surface, same as the soft getter', () => {
    expect(getCategoryToneStrong('קטגוריה-לא-קיימת')).toBe(FALLBACK_TONE)
  })
})
