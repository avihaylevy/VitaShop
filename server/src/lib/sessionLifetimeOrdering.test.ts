import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 🔴 LOGGING IN MUST RESET THE GUEST'S EXTENDED LIFETIME.
 *
 * Checkpoint B gave anonymous sessions a 30-day rolling cookie (§7.9 C4) and
 * left authenticated sessions at 24 hours. That separation holds TODAY for a
 * reason nobody had written down or tested: `auth.ts` REGENERATES the session
 * BEFORE setting `userId`, so the logged-in request gets a brand-new session
 * carrying the middleware's 24-hour cookie, and the 30-day `maxAge` dies with
 * the old one.
 *
 * ⚠️ That is DEC-053's ordering doing DOUBLE DUTY — it exists to stop a
 * phantom session, and it happens to also stop a month-long login. Nothing
 * named the second job, so nothing would have noticed it being lost.
 *
 * 🔴 WHY THIS IS A SOURCE-ORDER ASSERTION AND NOT A BEHAVIOURAL ONE, stated
 * plainly rather than hidden: the difference is only observable through a live
 * login against a verified user and a real cookie jar. This check is narrower
 * than that and says so — it pins the ORDERING that produces the behaviour.
 * It is mutation-proved: moving `regenerate` after the `userId` write turns it
 * red. A behavioural test belongs with the login integration suite if one is
 * ever built for the cookie.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const authSource = readFileSync(path.resolve(here, '../routes/auth.ts'), 'utf-8')

/**
 * 🔴 PER-ROUTE, not per-file. The first version of this test asked only
 * whether SOME regenerate appeared earlier in the file — and a mutation that
 * moved login's userId write above login's regenerate PASSED, because
 * registration's regenerate was still further up. That is the one-sided
 * assertion shape this project has eight recorded instances of, caught here by
 * mutation-testing the assertion rather than trusting it.
 */
function routeBlocks(source: string): { start: number; lines: string[] }[] {
  const lines = source.split(String.fromCharCode(10))
  const starts = lines
    .map((line, index) => (/^\s*router\.(get|post|patch|delete|put)\(/.test(line) ? index : -1))
    .filter((index) => index >= 0)

  return starts.map((start, position) => ({
    start,
    lines: lines.slice(start, starts[position + 1] ?? lines.length),
  }))
}

describe('DEC-053 ordering also protects the authenticated session lifetime', () => {
  const blocks = routeBlocks(authSource)
  const writing = blocks.filter((block) => block.lines.some((l) => /req\.session\.userId\s*=/.test(l)))

  it('the fixture is non-trivial — at least two routes really do write userId', () => {
    // Without this, deleting the writes would make the assertion below
    // vacuously true: no writes, nothing to check, green forever.
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    expect(writing.length).toBeGreaterThanOrEqual(2)
  })

  it('🔴 within EACH route, regenerate comes BEFORE the userId write', () => {
    for (const block of writing) {
      const firstWrite = block.lines.findIndex((l) => /req\.session\.userId\s*=/.test(l))
      const firstRegenerate = block.lines.findIndex((l) => /req\.session\.regenerate\(/.test(l))

      expect(
        firstRegenerate,
        `the route starting at line ${block.start + 1} writes userId without regenerating first`,
      ).toBeGreaterThanOrEqual(0)
      expect(
        firstRegenerate,
        `the route starting at line ${block.start + 1} writes userId at offset ${firstWrite} but ` +
          `regenerates only at offset ${firstRegenerate}. That session keeps the cookie it arrived ` +
          "with — including a guest's 30-day rolling maxAge, making the login last a month.",
      ).toBeLessThan(firstWrite)
    }
  })
})
