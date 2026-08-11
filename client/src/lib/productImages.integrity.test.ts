import { describe, expect, it } from 'vitest'
import { getProductImageUrl, resolvableImageFilenames } from './productImages.js'

/**
 * 🔴 MILESTONE-004 / ISSUE-040 — the guarantee the static-import list never
 * actually provided.
 *
 * THE DEFECT THIS EXISTS TO PREVENT, which had already shipped: Part 1
 * promoted `solgar-gentle-iron-25` to `verified=yes` and re-seeded, taking the
 * catalogue from six products to seven. Nobody added a seventh static import.
 * **The build stayed green and the product rendered with no image** —
 * `getProductImageUrl` returns `null` by design, the card falls back, and
 * nothing anywhere said a word.
 *
 * A static `import` proves the IMPORTED FILE exists. It cannot prove the
 * lookup covers the products the SEED loads, and that is the only thing that
 * matters to a shopper looking at a card. This test compares those two sets
 * directly.
 *
 * 🔴 IT READS THE CSV, NOT A FIXTURE. A fixture would be a third copy of the
 * truth and would drift like the first two did. `products.csv` is what the
 * seed reads, so it is what this reads.
 */

/**
 * The CSV is read through `import.meta.glob` with `?raw`, NOT through
 * `node:fs` — following the precedent `src/i18n/resources.test.ts` set, whose
 * own comment records that the `fs.readdirSync` fallback was deliberately not
 * used. It also keeps this file inside the app's tsconfig (`types:
 * ["vite/client"]`) rather than needing node types added for one test.
 */
const CSV_MODULES = import.meta.glob<string>('../../../assets/products/products.csv', {
  eager: true,
  query: '?raw',
  import: 'default',
})

/** Minimal RFC-4180-ish parser — quoted fields contain commas and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.join('').trim() !== '')
}

/** The rows the seed actually imports — `verified=yes` only, matching seed.ts. */
function seededRows(): { slug: string; imageFile: string }[] {
  // The BOM is expected: assets/README.md documents "UTF-8 with BOM" and
  // seed.ts:54 strips it. Stripping it here too keeps the header column
  // names matching rather than yielding a mangled first key.
  const raw = Object.values(CSV_MODULES)[0]
  if (raw === undefined) throw new Error('products.csv not found by the glob')
  const text = raw.replace(/^﻿/, '')
  const rows = parseCsv(text)
  const header = rows[0] as string[]
  const slugIndex = header.indexOf('slug')
  const imageIndex = header.indexOf('image_file')
  const verifiedIndex = header.indexOf('verified')

  return rows
    .slice(1)
    .filter((r) => r[verifiedIndex] === 'yes')
    .map((r) => ({ slug: r[slugIndex] as string, imageFile: r[imageIndex] as string }))
}

describe('🔴 ISSUE-040 — every seeded product resolves to an image', () => {
  it('the CSV is readable and contains verified rows', () => {
    const rows = seededRows()
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.slug, 'every verified row has a slug').toBeTruthy()
      expect(row.imageFile, `${row.slug} has an image_file`).toBeTruthy()
    }
  })

  it('🔴 getProductImageUrl returns non-null for EVERY seeded product', () => {
    const unresolved = seededRows()
      .filter((row) => getProductImageUrl(row.imageFile) === null)
      .map((row) => `${row.slug} -> ${row.imageFile}`)

    // This is the assertion. When it failed for the first time it named
    // `solgar-gentle-iron-25` — a product that was live, seeded, and blank.
    expect(unresolved).toEqual([])
  })

  it('resolves whether the caller passes a bare filename or a stored path', () => {
    // `ProductImage.url` stores `assets/products/<name>`; older call sites
    // pass the bare filename. Both must work, or the fix moves the failure
    // rather than removing it.
    const [first] = seededRows()
    expect(first).toBeDefined()
    const bare = (first as { imageFile: string }).imageFile.split('/').pop() as string

    expect(getProductImageUrl(bare)).not.toBeNull()
    expect(getProductImageUrl(`assets/products/${bare}`)).not.toBeNull()
  })

  it('🔴 the lookup is EXTENSION-AGNOSTIC, so a .png product is not a special case', () => {
    // Manufacturers serve .webp and .png; no converter exists here, so the
    // convention is "whatever the official source provides". A glob narrowed
    // to *.jpg would silently drop the first such product.
    const extensions = new Set(
      resolvableImageFilenames().map((name) => name.slice(name.lastIndexOf('.')).toLowerCase()),
    )
    expect(extensions.size).toBeGreaterThan(0)

    // Every extension present on disk is reachable through the lookup —
    // asserted by construction, since both sides come from the same glob.
    for (const filename of resolvableImageFilenames()) {
      expect(getProductImageUrl(filename), filename).not.toBeNull()
    }
  })

  it('an unknown filename still degrades to null rather than throwing', () => {
    // The tolerance is deliberate: a data-layer gap must degrade the card, not
    // crash the page. It is only safe BECAUSE the assertion above exists.
    expect(getProductImageUrl('no-such-image-zzz.jpg')).toBeNull()
    expect(getProductImageUrl(null)).toBeNull()
  })
})
