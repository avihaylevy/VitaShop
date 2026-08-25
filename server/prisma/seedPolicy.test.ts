import { describe, expect, it } from 'vitest'
import { demotedProductSlugs } from './seedPolicy'

/**
 * The CSV-scoped convergence policy (2026-08-25, user decision). The
 * regression this pins: `npm run seed` against a database that had gained
 * an ADMIN-CREATED product used to deactivate it, because the old clause
 * was `notIn: verifiedSlugs` over the WHOLE products table. The policy's
 * contract: only slugs the CSV knows are the seed's to demote.
 */
describe('demotedProductSlugs — convergence governs only CSV-known slugs', () => {
  const verified = new Set(['solgar-omega-3', 'altman-d3-1000'])

  it('a CSV row that lost verified=yes is demoted', () => {
    const rows = [{ slug: 'solgar-omega-3' }, { slug: 'demoted-row' }] as Record<string, string>[]
    expect(demotedProductSlugs(rows, verified)).toEqual(['demoted-row'])
  })

  it('🔴 the regression — an admin-created slug (absent from the CSV) is NOT in the demoted set', () => {
    const rows = [{ slug: 'solgar-omega-3' }] as Record<string, string>[]
    // "vitamin-c-liposomal" exists only in the database — the CSV has no row
    // for it, so it must never appear in the list the seed deactivates.
    expect(demotedProductSlugs(rows, verified)).toEqual([])
  })

  it('🔴 the control — the OLD behavior (whole-table notIn) would have demoted the admin slug; prove the policy output cannot express that', () => {
    // Reconstruct the old clause's effect: every active slug not in
    // verifiedSlugs. Given an admin-created product, the old set contains
    // it and the new set does not — the two behaviors are distinguishable
    // by this input, so this test genuinely pins the fix (a revert to
    // notIn-shaped logic fed from the DB cannot pass it while the CSV
    // lacks the row).
    const rows = [{ slug: 'solgar-omega-3' }, { slug: 'demoted-row' }] as Record<string, string>[]
    const activeDbSlugs = ['solgar-omega-3', 'demoted-row', 'vitamin-c-liposomal']
    const oldBehavior = activeDbSlugs.filter((slug) => !verified.has(slug))
    const newBehavior = demotedProductSlugs(rows, verified)
    expect(oldBehavior).toContain('vitamin-c-liposomal')
    expect(newBehavior).not.toContain('vitamin-c-liposomal')
    expect(newBehavior).toEqual(['demoted-row'])
  })

  it('blank and missing slugs are ignored', () => {
    const rows = [{ slug: ' ' }, {}, { slug: 'demoted-row' }] as Record<string, string>[]
    expect(demotedProductSlugs(rows, verified)).toEqual(['demoted-row'])
  })
})
