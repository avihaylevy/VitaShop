import path from 'node:path'

/**
 * DEC-089c — THE one home for every uploads-path fact (review finding:
 * the first build spread '/uploads/products/' across five call sites in
 * four files, so a rename would have broken the schema against the very
 * URLs the upload route mints).
 *
 * The CLIENT necessarily keeps one copy of the URL prefix (no shared
 * module across tiers): `client/src/lib/resolveProductImage.ts` — change
 * one, change both.
 *
 * ⚠️ THE DIRECTORY IS CWD-ANCHORED, and honestly so (review finding: the
 * first comment claimed "repo-root server/uploads" as if it were fixed).
 * Every server/package.json script runs with cwd = server/, so the store
 * lands at server/uploads in dev and tests. A launcher with a different
 * cwd (a root orchestration script, a process manager, Docker) MUST set
 * UPLOADS_DIR explicitly or every previously uploaded image 404s
 * silently. technical/DEPLOYMENT.md's trap list is where that goes.
 */
export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), 'uploads')

/** The subdirectory product uploads live in, and the only one served. */
export const PRODUCTS_UPLOAD_DIR = path.join(UPLOADS_DIR, 'products')

/** The URL shape the upload route mints and the schema/mapper recognise. */
export const UPLOAD_URL_PREFIX = '/uploads/products/'

export function mintUploadUrl(filename: string): string {
  return `${UPLOAD_URL_PREFIX}${filename}`
}

export function isUploadRef(url: string): boolean {
  return url.startsWith(UPLOAD_URL_PREFIX)
}

/** The schema's regex, built FROM the prefix so the two cannot drift. */
export const UPLOAD_REF_PATTERN = new RegExp(
  `^${UPLOAD_URL_PREFIX.replace(/\//g, '\\/')}[A-Za-z0-9][A-Za-z0-9._-]*$`,
)
