/**
 * Image-normalisation framing lookup — design/DESIGN_SYSTEM.md §7 and
 * technical/UI_IMPLEMENTATION_PLAN.md §8 (Accepted, DEC-036, Option A:
 * a JSON file in the client, keyed by image filename — interim, no
 * schema change).
 *
 * The JSON is generated ONCE per asset by scripts/measure-image-framing.py
 * from each asset's trimmed content bounding box. Never hand-written,
 * never a per-card CSS exception (§7).
 *
 * A missing entry falls back to `object-fit: contain` at 86% and logs a
 * warning — degraded, not broken (plan §8).
 */
import imageFramingData from '../data/imageFraming.json'

export type ImageFraming = {
  frameWidthPct: number
  frameHeightPct: number
  shiftXPct: number
  shiftYPct: number
}

export const FALLBACK_FRAMING: ImageFraming = {
  frameWidthPct: 86,
  frameHeightPct: 86,
  shiftXPct: 0,
  shiftYPct: 0,
}

const FRAMING_BY_FILE = imageFramingData as Readonly<Record<string, ImageFraming>>

const warnedMissingFraming = new Set<string>()

export function getImageFraming(imageFile: string | null): ImageFraming {
  if (imageFile === null) {
    return FALLBACK_FRAMING
  }

  const framing = FRAMING_BY_FILE[imageFile]
  if (framing !== undefined) {
    return framing
  }

  if (import.meta.env.DEV && !warnedMissingFraming.has(imageFile)) {
    warnedMissingFraming.add(imageFile)
    console.warn(`getImageFraming: no computed framing for "${imageFile}", falling back to 86% contain`)
  }

  return FALLBACK_FRAMING
}
