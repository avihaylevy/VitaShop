/**
 * Frame geometry for `vitashop-logo-transparent.png` — replaces a flawed
 * `object-fit: cover` attempt. `cover`'s crop is driven by the FULL
 * CANVAS's aspect ratio vs. the box, not by the trimmed content's much
 * wider aspect. Every revision of this asset has a canvas far squarer
 * than any usable header-logo box (~5.5:1 content), so `cover` is always
 * width-constrained: it spends box width on transparent side-padding
 * (rendering the wordmark smaller than intended, which read as "soft")
 * and centres on the canvas midpoint instead of the content's own,
 * clipping the content's edge by whatever the two midpoints differ.
 *
 * Fix: scale from the CONTENT's own bounding box, then translate so the
 * content is centred in a wrapper sized to content + a safe margin.
 * Content bbox is measured by alpha scan — never hand-estimated — by the
 * committed derivation script `scripts/make-logo-transparent.py`, which
 * prints it when regenerating the transparent asset; the doc of record is
 * design/CONTENT_ASSETS.md in the memory system. Re-measured 2026-08-25
 * for the user's replacement artwork (VitaShop-correct.png — teal mark +
 * navy wordmark): x=249, y=358, w=1212, h=222 inside the 1672×941 canvas.
 */

const SOURCE_WIDTH = 1672
const SOURCE_HEIGHT = 941
const CONTENT_X = 249
const CONTENT_Y = 358
const CONTENT_WIDTH = 1212
const CONTENT_HEIGHT = 222

/** 8% of the scaled content's own size, split evenly on each side — enough to never clip, small enough not to shrink the logo. */
const MARGIN_RATIO = 0.08

export type LogoFrame = {
  wrapperWidth: number
  wrapperHeight: number
  imageWidth: number
  imageHeight: number
  offsetX: number
  offsetY: number
}

/**
 * @param contentHeight the desired rendered height of the artwork itself
 *   (DESIGN_SYSTEM.md §5's approved visible logo height — 26 desktop, 21
 *   mobile). All output values are rounded to whole pixels so nothing
 *   renders at a fractional/sub-pixel size, which is its own source of
 *   softness independent of image scaling.
 */
export function computeLogoFrame(contentHeight: number): LogoFrame {
  const scale = contentHeight / CONTENT_HEIGHT
  const scaledContentWidth = CONTENT_WIDTH * scale
  const marginX = scaledContentWidth * MARGIN_RATIO
  const marginY = contentHeight * MARGIN_RATIO

  const wrapperWidth = scaledContentWidth + 2 * marginX
  const wrapperHeight = contentHeight + 2 * marginY

  const offsetX = marginX - CONTENT_X * scale
  const offsetY = marginY - CONTENT_Y * scale

  return {
    wrapperWidth: Math.round(wrapperWidth),
    wrapperHeight: Math.round(wrapperHeight),
    imageWidth: Math.round(SOURCE_WIDTH * scale),
    imageHeight: Math.round(SOURCE_HEIGHT * scale),
    offsetX: Math.round(offsetX),
    offsetY: Math.round(offsetY),
  }
}

/** 26px — DESIGN_SYSTEM.md §5, desktop header. */
export const DESKTOP_LOGO_FRAME = computeLogoFrame(26)

/** 21px — DESIGN_SYSTEM.md §5, mobile header. */
export const MOBILE_LOGO_FRAME = computeLogoFrame(21)
