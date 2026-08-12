/**
 * The products/ingredients CSV reader, extracted from `prisma/seed.ts` on
 * 2026-08-12 so the SEED and the CONVERGENCE TEST read the source of truth
 * through THE SAME CODE.
 *
 * 🔴 That sharing is the point. A test with its own parser proves the database
 * agrees with the test's idea of the CSV, which is not the claim anyone wants.
 * The claim is that the database agrees with the FILE.
 *
 * Behaviour is byte-for-byte what the seed already had; nothing was relaxed in
 * the move.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Strict RFC4180 CSV parser — no new dependency added (CLAUDE.md: adding
// a dependency requires a stop-and-ask; this is a small, fully-specified
// grammar). A quote character is legal ONLY as the delimiter of a quoted
// field (opening/closing) or doubled inside one ("" -> literal "). A bare
// quote anywhere else is a malformed file, not something to route around —
// it throws with the exact line number rather than silently merging or
// "recovering" rows. The source CSV itself must be valid; see
// assets/products/ingredients.csv, corrected 2026-08-02 to properly quote
// every value containing a literal " (מ"ג -> "מ""ג", etc). ────────────────
export function parseCsv(text: string): string[][] {
  const cleaned = text.replace(/^﻿/, '') // strip UTF-8 BOM — assets/README.md: "UTF-8 with BOM"
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let fieldWasQuoted = false
  let i = 0
  let line = 1
  while (i < cleaned.length) {
    const c = cleaned[i]
    if (inQuotes) {
      if (c === '"') {
        if (cleaned[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        const next = cleaned[i]
        if (next !== undefined && next !== ',' && next !== '\r' && next !== '\n') {
          throw new Error(
            `Malformed CSV at line ${line}: character "${next}" immediately follows a closing quote — ` +
              `only a comma or a line break may follow the closing " of a quoted field.`,
          )
        }
        continue
      }
      if (c === '\n') line++
      field += c
      i++
      continue
    }
    if (c === '"') {
      if (field.length > 0 || fieldWasQuoted) {
        throw new Error(
          `Malformed CSV at line ${line}: a " appeared outside a quoted field (field so far: "${field}"). ` +
            `A literal quote must be escaped by wrapping the whole field in quotes and doubling it, e.g. "מ""ג".`,
        )
      }
      inQuotes = true
      fieldWasQuoted = true
      i++
      continue
    }
    if (c === ',') {
      row.push(field)
      field = ''
      fieldWasQuoted = false
      i++
      continue
    }
    if (c === '\r') {
      i++
      continue
    }
    if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      fieldWasQuoted = false
      line++
      i++
      continue
    }
    field += c
    i++
  }
  if (inQuotes) {
    throw new Error(`Malformed CSV: file ends inside an unterminated quoted field (started before line ${line}).`)
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

export function parseCsvFile(filePath: string): Record<string, string>[] {
  const text = readFileSync(filePath, 'utf-8')
  const rows = parseCsv(text)
  const header = rows[0]
  if (!header) return []
  const dataRows = rows.slice(1)
  dataRows.forEach((r, idx) => {
    if (r.length !== header.length) {
      throw new Error(
        `Malformed CSV in ${filePath}: data row ${idx + 2} has ${r.length} column(s), header has ${header.length}. ` +
          `Row: ${JSON.stringify(r)}`,
      )
    }
  })
  return dataRows.map((r) => {
    const obj: Record<string, string> = {}
    header.forEach((col, idx) => {
      obj[col] = r[idx] ?? ''
    })
    return obj
  })
}

// ── Paths — assets/ lives at the repo root (DEC-016). Resolved here rather
// than in each caller so the seed and the tests cannot drift onto different
// files, which would make a convergence assertion meaningless. ────────────
const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const repoRootFromLib = path.resolve(moduleDir, '../../..')
export const PRODUCTS_CSV_PATH = path.join(repoRootFromLib, 'assets/products/products.csv')
export const INGREDIENTS_CSV_PATH = path.join(repoRootFromLib, 'assets/products/ingredients.csv')

/** Rows of products.csv whose `verified` column is exactly "yes". */
export function readVerifiedProductRows(): Record<string, string>[] {
  return parseCsvFile(PRODUCTS_CSV_PATH).filter((row) => (row.verified ?? '').trim() === 'yes')
}
