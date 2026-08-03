/**
 * Frame geometry for `vitashop-logo-transparent.png` — replaces a flawed
 * `object-fit: cover` attempt. `cover`'s crop is driven by the FULL
 * CANVAS's own aspect ratio (1536×1024 = 1.5) vs. the box, not by the
 * trimmed content's aspect ratio (5.58). Since 1.5 is squarer than any
 * usable header-logo box (~6:1), `cover` is *always* width-constrained
 * for this asset — it shows the entire 1536px width (including ~360px of
 * side padding) and only ever crops vertically. Two real consequences,
 * confirmed by the arithmetic, not assumed:
 *   1. The rendered wordmark ends up smaller than intended, because a
 *      third of the box's width is unavoidably spent on transparent
 *      side-padding instead of letters — this is what read as "soft".
 *   2. Centering on the CANVAS's vertical midpoint (512) instead of the
 *      CONTENT's own vertical midpoint (484.5, since the content sits
 *      higher in the canvas than centre) clipped ~5.5 original-px off
 *      the content's top edge — sub-pixel at these sizes, but real, and
 *      exactly the kind of accidental clip this rewrite removes on
 *      principle rather than leaving in place because it's small.
 *
 * Fix: scale from the CONTENT's own bounding box, then translate so the
 * content is centred in a wrapper sized to content + a safe margin.
 * Content bbox (measured by pixel/alpha scan, see CONTENT_ASSETS.md):
 * x=187, y=379, w=1177, h=211 inside the 1536×1024 canvas.
 */

const SOURCE_WIDTH = 1536
const SOURCE_HEIGHT = 1024
const CONTENT_X = 187
const CONTENT_Y = 379
const CONTENT_WIDTH = 1177
const CONTENT_HEIGHT = 211

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
