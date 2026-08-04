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

  it('every computed frameHeightPct matches the §7 target of 76%', () => {
    for (const file of VERIFIED_IMAGE_FILES) {
      expect(getImageFraming(file).frameHeightPct).toBe(76)
    }
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

  it('the six verified files exactly match products.csv verified=yes rows', () => {
    expect(VERIFIED_IMAGE_FILES).toHaveLength(6)
  })
})
