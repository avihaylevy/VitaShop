/**
 * Verified product image lookup — filename (the `ProductImage.url` join
 * key, per server/prisma/seed.ts) to an imported, Vite-resolved asset URL.
 *
 * TASK-010 Checkpoint A, Q2/Q3 approval: byte-identical copies of the six
 * DEC-032 verified source JPGs live in client/src/assets/products/,
 * originals under assets/products/ untouched. Static explicit imports only
 * — no dynamic `import()` by filename, so a typo or an unverified filename
 * fails at build time, not at runtime.
 *
 * Original Hebrew filenames are kept as-is in this slice (Q3). ASCII
 * aliasing / a web-optimised derivative is a separate future decision,
 * not made here.
 */
import omega3 from '../assets/products/אומגה 3 של חברת סולגאר.jpg'
import vitaminCBerry from '../assets/products/ויטמין C בטעם פטל חמוציות של חברת סולגאר.jpg'
import vitaminD from '../assets/products/טבליות ויטמין D של חברת סופרהרב.jpg'
import magnesiumMax550 from '../assets/products/מגנזיות מקס 550 של חברת סופרהרב.jpg'
import b12 from '../assets/products/סולגר טבליות ויטמין B12.jpg'
import calMagD3 from '../assets/products/סולגר טבליות סידן ומגנזיום בתוספת ויטמין D3.jpg'

const PRODUCT_IMAGE_URLS: Readonly<Record<string, string>> = {
  'אומגה 3 של חברת סולגאר.jpg': omega3,
  'ויטמין C בטעם פטל חמוציות של חברת סולגאר.jpg': vitaminCBerry,
  'טבליות ויטמין D של חברת סופרהרב.jpg': vitaminD,
  'מגנזיות מקס 550 של חברת סופרהרב.jpg': magnesiumMax550,
  'סולגר טבליות ויטמין B12.jpg': b12,
  'סולגר טבליות סידן ומגנזיום בתוספת ויטמין D3.jpg': calMagD3,
}

const warnedMissingImageFiles = new Set<string>()

/**
 * Returns the resolved asset URL for a verified product image filename,
 * or `null` if the filename has no imported asset. `null` is the
 * missing-image state (ProductImage renders its fallback well) — this
 * function never throws, since a data-layer gap must degrade the card,
 * not crash it.
 */
export function getProductImageUrl(imageFile: string | null): string | null {
  if (imageFile === null) {
    return null
  }

  const url = PRODUCT_IMAGE_URLS[imageFile]
  if (url !== undefined) {
    return url
  }

  if (import.meta.env.DEV && !warnedMissingImageFiles.has(imageFile)) {
    warnedMissingImageFiles.add(imageFile)
    console.warn(`getProductImageUrl: no imported asset for "${imageFile}", falling back to missing-image state`)
  }

  return null
}
