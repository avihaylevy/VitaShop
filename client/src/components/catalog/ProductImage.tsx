import { useState, type CSSProperties } from 'react'
import { getProductImageUrl } from '../../lib/productImages'
import { getImageFraming } from '../../lib/imageFraming'

type ProductImageProps = {
  imageFile: string | null
  alt: string
  className?: string
}

/**
 * Fixed 4:3 well. object-fit: contain only (DESIGN_SYSTEM.md §7) — never
 * cover/crop/blend. Missing image and load failure both degrade to the same
 * empty well, at the same dimensions, with no broken-image icon.
 */
export function ProductImage({ imageFile, alt, className = '' }: ProductImageProps) {
  const [failed, setFailed] = useState(false)
  const url = getProductImageUrl(imageFile)
  const framing = getImageFraming(imageFile)
  const showImage = url !== null && !failed

  return (
    <div className={`relative aspect-[4/3] w-full overflow-hidden rounded-card bg-well ${className}`}>
      {showImage && (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          // DESIGN_SYSTEM.md §3: card hover scales the image to 1.025. The
          // framing offset above is a static, per-image inline transform, so
          // the hover scale can't be a competing inline style (it would just
          // overwrite the offset) — it's threaded through as a CSS custom
          // property instead, referenced from the one `transform` value
          // below. motion-safe: gates only the property that changes it, so
          // under prefers-reduced-motion the scale term stays permanently 1
          // and the image never moves.
          className="absolute inset-0 m-auto object-contain transition-transform duration-200 ease-standard [--img-hover-scale:1] motion-safe:group-hover:[--img-hover-scale:1.025] [transform:translate(var(--img-shift-x),var(--img-shift-y))_scale(var(--img-hover-scale))]"
          style={
            {
              width: `${framing.frameWidthPct}%`,
              height: `${framing.frameHeightPct}%`,
              '--img-shift-x': `${framing.shiftXPct}%`,
              '--img-shift-y': `${framing.shiftYPct}%`,
            } as CSSProperties
          }
        />
      )}
    </div>
  )
}
