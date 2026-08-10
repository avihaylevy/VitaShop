// §3 / §3a — Prisma search contract and implementation form, frozen at
// MILESTONE-005 Checkpoint A, escape helper implemented pure at Checkpoint C.
// Search EXECUTION (buildSearchWhere below, actually querying Prisma with the
// escaped term) is Checkpoint E's job.

import type { Prisma } from '@prisma/client'

// Escapes a term for safe use inside a Prisma `contains` filter so LIKE
// metacharacters in the user's input are matched literally, never as
// wildcards. Order is frozen and matters: the escape character itself must
// be escaped FIRST, or a user-supplied backslash would corrupt a later
// %/_ escape (e.g. escaping `_` before `\` would turn a literal `\_` into
// `\\_` instead of the intended `\\\_`).
export function escapeLikeLiteral(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

// 🛑 §3a stop condition — "if the current Prisma 7 / PostgreSQL provider does
// not support `contains` + `mode: 'insensitive'` for any required relation
// field, work stops and the constraint is reported."
//
// Verified at Checkpoint C WITHOUT executing a live query (Checkpoint C never
// touches the database): this object literal only type-checks if the
// generated Prisma Client's `Prisma.ProductWhereInput` actually exposes
// `contains` + `mode: 'insensitive'` on every §3-required field, including
// nested relation filters. If Prisma's generated types ever stop supporting
// this shape, `tsc` fails here — the stop condition is enforced at compile
// time, not at runtime. Never constructed or executed; exists for its type
// alone.
export function assertPrismaSearchFormSupported(): Prisma.ProductWhereInput {
  return {
    nameHe: { contains: 'x', mode: 'insensitive' },
    nameEn: { contains: 'x', mode: 'insensitive' },
    descriptionHe: { contains: 'x', mode: 'insensitive' },
    descriptionEn: { contains: 'x', mode: 'insensitive' },
    brand: { name: { contains: 'x', mode: 'insensitive' } },
    ingredients: {
      some: { activeIngredient: { name: { contains: 'x', mode: 'insensitive' } } },
    },
    category: {
      OR: [
        { nameHe: { contains: 'x', mode: 'insensitive' } },
        { nameEn: { contains: 'x', mode: 'insensitive' } },
      ],
    },
    healthGoals: {
      some: {
        healthGoal: {
          OR: [
            { nameHe: { contains: 'x', mode: 'insensitive' } },
            { nameEn: { contains: 'x', mode: 'insensitive' } },
          ],
        },
      },
    },
  }
}

// MILESTONE-005 Checkpoint E — §3's searchable-field list, executed: literal
// substring, bilingual, partial-word, case-insensitive, OR across every
// field. `q` here is the ALREADY-TRIMMED, 1–80-char term from Checkpoint C
// (parseCatalogProductsQuery) — this function escapes it (§3a) and builds
// the OR clause; it never re-validates length/emptiness. Returns `undefined`
// when no search term was supplied, so callers can omit the clause entirely
// rather than AND-ing in a vacuous always-true condition.
export function buildSearchWhere(q: string | undefined): Prisma.ProductWhereInput | undefined {
  if (q === undefined) return undefined

  const term = escapeLikeLiteral(q)
  const contains = { contains: term, mode: 'insensitive' as const }

  return {
    OR: [
      { nameHe: contains },
      { nameEn: contains },
      { descriptionHe: contains },
      { descriptionEn: contains },
      { brand: { name: contains } },
      { ingredients: { some: { activeIngredient: { name: contains } } } },
      { category: { nameHe: contains } },
      { category: { nameEn: contains } },
      { healthGoals: { some: { healthGoal: { nameHe: contains } } } },
      { healthGoals: { some: { healthGoal: { nameEn: contains } } } },
    ],
  }
}
