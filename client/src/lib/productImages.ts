/**
 * Product image lookup — the `ProductImage.url` filename (the join key, per
 * `server/prisma/seed.ts`) to a Vite-resolved asset URL.
 *
 * 🔴 REWRITTEN 2026-08-11, MILESTONE-004, resolving ISSUE-040 — after the
 * previous mechanism shipped a live defect.
 *
 * WHAT IT USED TO BE: a hand-maintained list of six static `import` lines and
 * a six-entry map, over byte-identical copies of the source images kept in
 * `client/src/assets/products/`. Its comment defended that as build-time
 * safety: "no dynamic import() by filename, so a typo or an unverified
 * filename fails at BUILD time, not at runtime."
 *
 * 🔴 WHY THAT ARGUMENT DID NOT HOLD. A static import proves the IMPORTED FILE
 * exists. It proves nothing about whether the map's KEYS match the products
 * the seed actually loads — and that is the failure that happened. Part 1
 * promoted `solgar-gentle-iron-25` to verified and re-seeded it, taking the
 * catalogue to seven products. Nobody added the seventh import. The build
 * stayed green, `getProductImageUrl` returned `null`, the card fell back, and
 * a product shipped with no image. **The guarantee was pointed at the wrong
 * side of the boundary.**
 *
 * WHAT REPLACES IT — two changes, and the second is the one that matters:
 *
 *   1. `import.meta.glob` over the repo-root `assets/products/` directory.
 *      Still resolved at BUILD time by Vite (hashing and optimisation
 *      intact), but with no per-product edit. At 30 products the manual list
 *      was a chore; at 50 it was a guarantee that someone would forget a row.
 *
 *   2. 🔴 `productImages.integrity.test.ts` — every product the SEED loads
 *      must resolve to a non-null URL. That is a STRONGER guarantee than
 *      static imports ever gave, because it compares the two things that
 *      actually have to agree: the CSV's rows and the client's resolvable
 *      images. It is the client-side counterpart of the check that ran over
 *      the CSV before Part 1 was staged.
 *
 * 🔴 NO MORE DUPLICATE COPIES. `client/src/assets/products/` is gone. Keeping
 * a byte-identical copy per product would have preserved exactly the manual
 * per-product step this change exists to remove — the import line would go,
 * and a copy step would take its place. The glob reads the ONE source of
 * truth under `assets/products/`, which is also what the seed reads, so the
 * client and the database can no longer disagree about which file is current.
 * The cost is a `server.fs.allow` entry in `vite.config.ts`; that is a real
 * coupling of the client build to `assets/`, and it is deliberate — they were
 * already coupled by filename, just without anything enforcing it.
 *
 * 🔴 FILE FORMAT: **whatever the official source provides.** The existing six
 * are `.jpg`; manufacturers serve `.webp` and `.png`, and no converter exists
 * in this environment. The glob is extension-agnostic on purpose, and the
 * integrity test covers every extension in use — so a `.png` product is not a
 * special case anyone has to remember.
 */

/**
 * Eager, URL-only glob over the source-of-truth directory.
 *
 * `eager` so this stays a plain synchronous lookup — the callers are render
 * paths and must not become async. `query: '?url'` emits the asset URL rather
 * than inlining the file.
 *
 * 🔴 The pattern lists IMAGE EXTENSIONS explicitly, and both halves of that
 * matter:
 *
 *   · It is not `*.jpg`. Narrowing to one format would silently drop the
 *     first `.png` product — the same class of quiet failure this rewrite
 *     exists to end.
 *   · It is NOT `*.*` either. The first version of this change used `*.*`,
 *     and the production build caught it immediately: `assets/products/` also
 *     holds `products.csv` and `ingredients.csv`, so `*.*` bundled **25 kB of
 *     product data — including the internal `notes` column with sourcing
 *     commentary — into the public build.** Waste, and a small disclosure of
 *     material never meant to ship.
 *
 * Add a format here when a manufacturer serves one; the integrity test fails
 * loudly if a seeded product's image is not matched.
 */
const ASSET_URLS = import.meta.glob<string>('../../../assets/products/*.{jpg,jpeg,png,webp,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
})

/**
 * Keyed by bare filename, which is what `ProductImage.url` stores. The glob
 * keys are paths relative to this module, so only the last segment is used.
 */
const PRODUCT_IMAGE_URLS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ASSET_URLS).map(([path, url]) => [path.split('/').pop() as string, url]),
)

/** Exported for the integrity test — the set of filenames the client can resolve. */
export function resolvableImageFilenames(): string[] {
  return Object.keys(PRODUCT_IMAGE_URLS)
}

const warnedMissingImageFiles = new Set<string>()

/**
 * Returns the resolved asset URL for a product image filename, or `null` if
 * no asset matches. `null` is the missing-image state (`ProductImage` renders
 * its fallback well) — this function never throws, since a data-layer gap
 * must degrade the card, not crash it.
 *
 * ⚠️ That tolerance is why the defect above was invisible, so it is now
 * backed by a test rather than by hope. Keep the tolerance; keep the test.
 */
export function getProductImageUrl(imageFile: string | null): string | null {
  if (imageFile === null) {
    return null
  }

  // The seed stores `assets/products/<name>`; older callers may pass the bare
  // filename. Accept both and key on the last segment.
  const filename = imageFile.split('/').pop() ?? imageFile

  const url = PRODUCT_IMAGE_URLS[filename]
  if (url !== undefined) {
    return url
  }

  if (import.meta.env.DEV && !warnedMissingImageFiles.has(imageFile)) {
    warnedMissingImageFiles.add(imageFile)
    console.warn(
      `getProductImageUrl: no asset under assets/products/ for "${imageFile}", falling back to missing-image state`,
    )
  }

  return null
}
