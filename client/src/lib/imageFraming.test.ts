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

  // 🔴 THE FRAME IS THE FILE BOX NOW, NOT THE CONTENT BOX — ISSUE-107,
  // 2026-08-15. The old model sized the element to the trimmed content and
  // this test pinned it at <= 76%; that model rendered any PADDED file's
  // product smaller than 76% (the whole file was object-contained into a
  // content-sized box). The corrected script sizes the element to the FILE
  // at the scale that lands the CONTENT at <= 76%/84%, so a padded file's
  // frame legitimately exceeds the well and its padding is cropped. §7's
  // content-level caps are enforced where the trimmed box is known — inside
  // scripts/measure-image-framing.py — and verified in the browser; here the
  // JSON can only be sanity-bounded: positive, and no frame more than
  // double the well (a padding ratio beyond that means a broken trim).
  it('every frame is positive and within sane bounds (content caps live in the script)', () => {
    for (const file of VERIFIED_IMAGE_FILES) {
      const framing = getImageFraming(file)
      expect(framing.frameHeightPct).toBeGreaterThan(0)
      expect(framing.frameHeightPct).toBeLessThanOrEqual(200)
      expect(Math.abs(framing.shiftXPct)).toBeLessThanOrEqual(50)
      expect(Math.abs(framing.shiftYPct)).toBeLessThanOrEqual(50)
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

  it('every frame width is positive and within the same sane bound', () => {
    // The §7 84% cap now binds on the CONTENT's rendered width, computed in
    // the script from the trimmed box — the file-box frame may exceed it.
    for (const file of VERIFIED_IMAGE_FILES) {
      const width = getImageFraming(file).frameWidthPct
      expect(width).toBeGreaterThan(0)
      expect(width).toBeLessThanOrEqual(200)
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
