/**
 * DEC-032 DECISION B (Accepted 2026-08-12) — the `warnings_allergens` third
 * state, as a validated pair rather than a single field.
 *
 * 🔴 PROVENANCE, NOT ABSENCE. `allergenInfoIncomplete` is a claim about the
 * SOURCE: the manufacturer's page was checked, and `warningsAllergens` already
 * holds everything it publishes. It COMPOSES with that field rather than
 * replacing it — which is why this is a boolean and not an enum. The row that
 * forced the shape is `salus-multi-syrup`: it publishes real declarations
 * (ללא גלוטן · ללא אלכוהול) AND is still missing a complete one, so it is
 * flag-true and text-non-empty at the same time. An enum would have made that
 * row self-contradictory.
 *
 * Lives in `src/lib` rather than inside `prisma/seed.ts` for the reason
 * `syncProductRelations.ts` does (commit 8edd538): a rule with no test is a
 * rule nobody has seen fail.
 */

/** The four legal (flag, text) combinations. Anything else is a seed error. */
export type AllergenFields = {
  warningsAllergens: string
  allergenInfoIncomplete: boolean
}

/**
 * CSV column `allergen_info_incomplete`.
 *
 * 🔴 Strict: only "", "no" or "yes" (case-insensitive). Anything else THROWS
 * rather than being coerced — a silently-false medical provenance flag looks
 * identical to a row whose allergen data really is complete, which is the
 * exact failure this column exists to prevent.
 */
export function parseAllergenInfoIncomplete(value: string | undefined, slug: string): boolean {
  const trimmed = (value ?? '').trim().toLowerCase()
  if (trimmed === '' || trimmed === 'no') return false
  if (trimmed === 'yes') return true
  throw new Error(
    `Malformed verified row "${slug}": "allergen_info_incomplete" must be "yes", "no" or empty, got "${value}".`,
  )
}

/**
 * Field 12 and the flag, validated TOGETHER because their legality is joint:
 *
 *   false + ""    ✗ REJECTED — the pre-existing confirm-or-omit rule. A blank
 *                   allergen section on a verified row reads as "no allergens".
 *   false + text  ✓ a declaration
 *   true  + ""    ✓ the manufacturer publishes nothing, and that was CHECKED
 *   true  + text  ✓ partial, and that is all there is  (salus-multi-syrup)
 *
 * 🔴 The flag is the ONLY thing that makes an empty field legal, and it is a
 * positive claim that the source was checked — not an escape hatch for a row
 * nobody sourced.
 */
export function validateAllergenFields(row: Record<string, string>, slug: string): AllergenFields {
  const allergenInfoIncomplete = parseAllergenInfoIncomplete(row.allergen_info_incomplete, slug)
  const warningsAllergens = (row.warnings_allergens ?? '').trim()

  if (!allergenInfoIncomplete && warningsAllergens.length === 0) {
    throw new Error(
      `Malformed verified row "${slug}": required field "warnings_allergens" is empty. ` +
        `Set "allergen_info_incomplete" to "yes" only if the manufacturer's page was CHECKED and publishes none.`,
    )
  }

  return { warningsAllergens, allergenInfoIncomplete }
}
