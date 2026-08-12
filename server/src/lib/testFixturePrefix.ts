/**
 * The slug prefix reserved for SYNTHETIC test fixtures.
 *
 * 🔴 ONE FACT, ONE PLACE. It was declared twice — by the suite that CREATES
 * these rows (`syncProductRelations.integration.test.ts`) and by the suite that
 * must IGNORE them (`seedConvergence.integration.test.ts`). Two copies of a
 * value whose whole job is to match.
 *
 * ⚠️ The duplication failed in the SAFE direction, and that property is
 * preserved deliberately: if the producer's prefix changed, the consumer's
 * filter stopped matching, the fixtures surfaced as `inDatabaseButNotInCsv`,
 * and the convergence test went RED. Sharing the constant keeps that — a
 * mismatch is now impossible rather than merely loud, which is strictly
 * stronger. 🔴 What must never happen is the opposite: a tidy-up that turns a
 * loud failure into a silent one.
 */
export const TEST_FIXTURE_SLUG_PREFIX = 'zz-synctest-'

/** True for a row that belongs to a test suite rather than the catalogue. */
export function isTestFixtureSlug(slug: string): boolean {
  return slug.startsWith(TEST_FIXTURE_SLUG_PREFIX)
}
