import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { getApiBaseUrl } from '../../lib/apiBaseUrl'
import { getProductImageUrl } from '../../lib/productImages'
import { getImageFraming } from '../../lib/imageFraming'

type ProductImageProps = {
  imageFile: string | null
  alt: string
  className?: string
  /**
   * DEC-110 (UI refresh, area 1). 'well' is the unchanged default — 4:3 on
   * the white well — used by the cart row, the agent card, the detail page
   * and admin. 'card' is the catalogue card's frame: the same 4:3 box but
   * with NO white well — the cutout product sits directly on the card's
   * category tone (rendered ~15% larger than §7's 76%, see the style
   * below) with a soft drop shadow and a stronger hover zoom.
   * An image detected as OPAQUE (a photo with its own background) falls
   * back to the white well INSIDE the square, so it reads as a deliberate
   * frame instead of a raw rectangle — see detectCutout below.
   */
  frame?: 'well' | 'card'
}

/**
 * Pass 131 — is this image a transparent CUTOUT or an opaque photo?
 *
 * The card frame renders cutouts directly on the tone; an opaque photo
 * there shows its own background as a hard rectangle (the user's report:
 * B-50's white box, the ויטמין C lifestyle scene). CSS cannot tell the
 * two apart, so we ask the pixels once per URL: draw small, read the
 * corners' alpha. Any failure — no canvas (jsdom), a CORS-tainted
 * external image, a decode error — answers 'opaque', the SAFE fallback
 * (the white well always looks intentional; a raw rectangle never does).
 * This also covers every FUTURE admin upload with no pipeline work.
 */
const cutoutCache = new Map<string, boolean>()

function detectCutout(url: string, onResult: (isCutout: boolean) => void): void {
  const cached = cutoutCache.get(url)
  if (cached !== undefined) {
    onResult(cached)
    return
  }
  const probe = new Image()
  probe.crossOrigin = 'anonymous'
  probe.onload = () => {
    let isCutout = false
    try {
      // 🔴 NATURAL SIZE, never a downscale. A 24px thumbnail blends each
      // corner sample with nearby content — a box product whose art runs
      // close to the corner read alpha > 16 and was misjudged OPAQUE
      // (the user's "Biosil still has a white background" report). At
      // natural size the corner pixels are the file's actual corners.
      const w = probe.naturalWidth
      const h = probe.naturalHeight
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (ctx && w > 1 && h > 1) {
        ctx.drawImage(probe, 0, 0)
        const corners = [
          [0, 0],
          [w - 1, 0],
          [0, h - 1],
          [w - 1, h - 1],
        ] as const
        // A cutout has fully transparent corners; tolerate faint halos.
        isCutout = corners.every(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] < 16)
      }
    } catch {
      isCutout = false
    }
    cutoutCache.set(url, isCutout)
    onResult(isCutout)
  }
  probe.onerror = () => {
    cutoutCache.set(url, false)
    onResult(false)
  }
  probe.src = url
}

/**
 * Fixed box, object-fit: contain only (DESIGN_SYSTEM.md §7) — never
 * cover/crop/blend. Missing image and load failure both degrade to the same
 * empty well, at the same dimensions, with no broken-image icon.
 */
export function ProductImage({ imageFile, alt, className = '', frame = 'well' }: ProductImageProps) {
  const [failed, setFailed] = useState(false)
  /*
   * DEC-089b/c — the reference is one of THREE shapes, and the server's
   * `toImageRef` is the other half of this rule:
   *   · a build-time asset FILENAME — resolved through the
   *     import.meta.glob pipeline, with its measured per-image framing;
   *   · an ABSOLUTE http(s) URL (admin link) — rendered as-is;
   *   · a '/uploads/...' path (admin upload) — prefixed with the API base
   *     URL, kept relative in the DB so a host change cannot strand it.
   * The two admin shapes get the default framing.
   */
  const isExternal = imageFile !== null && /^https?:\/\//.test(imageFile)
  const isUpload = imageFile !== null && imageFile.startsWith('/uploads/')
  const base = getApiBaseUrl()
  const url = isExternal
    ? imageFile
    : isUpload
      ? base.ok
        ? `${base.value}${imageFile}`
        : null
      : getProductImageUrl(imageFile)
  const framing = getImageFraming(isExternal || isUpload ? null : imageFile)
  const showImage = url !== null && !failed

  /*
   * null = not yet known. The card frame starts from the cached answer when
   * there is one (no flash on revisits); an unknown image renders as a
   * cutout first and snaps to the well fallback only if the probe says
   * opaque — the majority of the catalogue is cutouts, so that is the
   * low-flash default.
   */
  const [isCutout, setIsCutout] = useState<boolean | null>(() =>
    url !== null ? (cutoutCache.get(url) ?? null) : null,
  )
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (frame !== 'card' || url === null) return
    let alive = true
    const runProbe = () => {
      detectCutout(url, (result) => {
        if (alive) setIsCutout(result)
      })
    }
    // The probe forces a full fetch+decode — gate it behind the same
    // near-viewport intent as the real <img>'s loading="lazy", instead of
    // firing eagerly for every off-screen card on first paint. jsdom (the
    // test environment) has no IntersectionObserver, so it falls back to
    // the previous eager behaviour there.
    const node = containerRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      runProbe()
      return () => {
        alive = false
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          runProbe()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    return () => {
      alive = false
      observer.disconnect()
    }
  }, [frame, url])

  const cardShowsWell = frame === 'card' && isCutout === false

  /*
   * frameWidthPct/frameHeightPct are measured assuming a 4:3 box
   * (measure-image-framing.py's WELL_ASPECT) — the card frame renders
   * 3:2, so scaling both axes by the same factor (as the well frame
   * does) would keep the WRONG ratio and letterbox the image inside
   * its own frame. CARD_ASPECT_CORRECTION re-derives the width axis so
   * the rendered box's pixel aspect still matches the source file's own
   * aspect. The ×1.15/0.86 "bigger/inset" tweak is then applied
   * uniformly (it cancels out of the ratio). Finally, if either axis
   * still exceeds 100% (ISSUE-107 already established some content
   * boxes legitimately measure that way), both axes are scaled down
   * together — never just clamped independently — so the frame's
   * overflow-hidden never crops the image, per this file's own
   * never-crop rule (line 85).
   */
  const CARD_ASPECT_CORRECTION = 8 / 9 // (4/3 measured) / (3/2 rendered)
  const cardScale = cardShowsWell ? 0.86 : 1.15
  let widthPct = frame === 'card' ? framing.frameWidthPct * CARD_ASPECT_CORRECTION * cardScale : framing.frameWidthPct
  let heightPct = frame === 'card' ? framing.frameHeightPct * cardScale : framing.frameHeightPct
  if (frame === 'card') {
    const overflow = Math.max(widthPct / 100, heightPct / 100, 1)
    widthPct /= overflow
    heightPct /= overflow
  }

  // Whole-string switch — never two conflicting bg-* utilities on one
  // element (class-attribute order does not decide such ties).
  const frameClass =
    frame === 'card'
      ? cardShowsWell
        ? // The opaque-photo fallback: the white well returns INSIDE the
          // box as a deliberate frame (the image itself is inset via
          // the scale factor below — padding cannot constrain an
          // absolutely-positioned child).
          'relative aspect-[3/2] w-full overflow-hidden rounded-card bg-well'
        : 'relative aspect-[3/2] w-full overflow-hidden rounded-card'
      : 'relative aspect-[4/3] w-full overflow-hidden rounded-card bg-well'
  const imageEffectClass =
    frame === 'card'
      ? cardShowsWell
        ? 'motion-safe:group-hover:[--img-hover-scale:1.06]'
        : '[filter:drop-shadow(0_4px_8px_rgb(31_37_46_/_0.08))] motion-safe:group-hover:[--img-hover-scale:1.06]'
      : 'motion-safe:group-hover:[--img-hover-scale:1.025]'

  return (
    <div ref={containerRef} className={`${frameClass} ${className}`}>
      {showImage && (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          // The framing offset is a static, per-image inline transform, so
          // the hover scale can't be a competing inline style (it would just
          // overwrite the offset) — it's threaded through as a CSS custom
          // property instead, referenced from the one `transform` value
          // below. motion-safe: gates only the property that changes it, so
          // under prefers-reduced-motion the scale term stays permanently 1
          // and the image never moves.
          className={`absolute inset-0 m-auto object-contain transition-transform duration-200 ease-standard [--img-hover-scale:1] ${imageEffectClass} [transform:translate(var(--img-shift-x),var(--img-shift-y))_scale(var(--img-hover-scale))]`}
          style={
            {
              // Pass 131 ("the product is too small"): the card frame scales
              // the MEASURED framing up 15% — content lands at ~87% of the
              // box height instead of §7's 76% (width-capped content tops
              // out at ~97%). The opaque-photo well fallback insets instead
              // (0.86), keeping a visible white margin around the photo.
              // widthPct/heightPct above already carry the aspect
              // correction and the crop-safety scale-down.
              width: `${widthPct}%`,
              height: `${heightPct}%`,
              '--img-shift-x': `${framing.shiftXPct}%`,
              '--img-shift-y': `${framing.shiftYPct}%`,
            } as CSSProperties
          }
        />
      )}
    </div>
  )
}
