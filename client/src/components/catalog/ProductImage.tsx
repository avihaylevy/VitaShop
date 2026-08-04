import { useState } from 'react'
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
          onError={() => setFailed(true)}
          className="absolute inset-0 m-auto object-contain"
          style={{
            width: `${framing.frameWidthPct}%`,
            height: `${framing.frameHeightPct}%`,
            transform: `translate(${framing.shiftXPct}%, ${framing.shiftYPct}%)`,
          }}
        />
      )}
    </div>
  )
}
