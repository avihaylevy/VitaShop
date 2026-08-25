/**
 * The seed's convergence policy for product ACTIVATION, extracted so it can
 * be unit-tested (2026-08-25, user decision): a re-run of the seed must
 * govern only the slugs the CSV KNOWS.
 *
 *   · A CSV row demoted from verified=yes (or deleted content leaving the
 *     slug behind) is DEMOTED — the seed deactivates it, exactly as before.
 *   · A product created through the ADMIN PANEL — its slug absent from the
 *     CSV entirely — is NOT the seed's to touch. Before this policy the
 *     seed's `notIn: verifiedSlugs` clause deactivated every such product
 *     on every re-run; on a deployed store, where the admin panel owns the
 *     catalogue after the one-time seed, that silently withdrew real
 *     products (it withdrew the user's ויטמין C ליפוזומלי the day this was
 *     extracted).
 *
 * The CSV's own say-so (`is_active`, DEC-076) is unaffected — it is applied
 * per-row by the upsert, not here.
 */
export function demotedProductSlugs(
  csvRows: ReadonlyArray<Record<string, string>>,
  verifiedSlugs: ReadonlySet<string>,
): string[] {
  return csvRows
    .map((row) => (row.slug ?? '').trim())
    .filter((slug) => slug !== '' && !verifiedSlugs.has(slug))
}
