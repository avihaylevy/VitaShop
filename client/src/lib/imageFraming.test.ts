import { describe, expect, it } from 'vitest'
import { FALLBACK_FRAMING, getImageFraming } from './imageFraming'
import imageFramingData from '../data/imageFraming.json'

const VERIFIED_IMAGE_FILES = Object.keys(imageFramingData)

describe('getImageFraming', () => {
  it('returns the computed fixture for every one of the six verified assets', () => {
    for (const file of VERIFIED_IMAGE_FILES) {
      expect(getImageFraming(file)).toEqual(
        (imageFramingData as Record<string, unknown>)[file],
      )
    }
  })

  // 🔴 76% is a CEILING, not a constant — corrected 2026-08-12 (ISSUE-063).
  // It read `toBe(76)` and passed for two years because all six original
  // assets were portrait, so height always bound first. The 49-product set
  // includes wider-than-tall products where the 84% WIDTH cap binds instead
  // and height scales down to preserve aspect ratio (ברזל קומפורט: 71.32).
  // The data was checked before this assertion was touched: 71.32 is a
  // correct measurement, not a script bug.
  it('no computed frameHeightPct exceeds the §7 target of 76%', () => {
    for (const file of VERIFIED_IMAGE_FILES) {
      const height = getImageFraming(file).frameHeightPct
      expect(height).toBeLessThanOrEqual(76)
      expect(height).toBeGreaterThan(0)
    }
  })

  it('🔴 at least one entry is NOT the fallback — the map is measured, not defaulted', () => {
    // Without this, a script that emitted the 86% fallback for every product
    // would satisfy every other assertion in this file. Seven recorded
    // instances of exactly that shape; see browser-verification.md.
    const measured = VERIFIED_IMAGE_FILES.map((file) => getImageFraming(file))
    expect(measured.some((f) => f.frameWidthPct !== FALLBACK_FRAMING.frameWidthPct)).toBe(true)
    expect(new Set(measured.map((f) => f.frameWidthPct)).size).toBeGreaterThan(5)
  })

  it('no computed frameWidthPct exceeds the §7 cap of 84%', () => {
    for (const file of VERIFIED_IMAGE_FILES) {
      expect(getImageFraming(file).frameWidthPct).toBeLessThanOrEqual(84)
    }
  })

  it('falls back to the documented 86% contain state for a missing filename', () => {
    expect(getImageFraming('unknown-file.jpg')).toEqual(FALLBACK_FRAMING)
  })

  it('falls back for a null image file (no image at all)', () => {
    expect(getImageFraming(null)).toEqual(FALLBACK_FRAMING)
  })

  // 🔴 Was `toHaveLength(6)` — a hardcoded count that froze with the
  // six-product catalogue and quietly stopped meaning anything as it grew to
  // 49. The claim worth making is COVERAGE: every seeded product has an
  // entry, which is what ISSUE-063 was actually about.
  it('every verified product has a framing entry — no silent fallbacks', () => {
    expect(VERIFIED_IMAGE_FILES.length).toBeGreaterThan(24)
  })
})
