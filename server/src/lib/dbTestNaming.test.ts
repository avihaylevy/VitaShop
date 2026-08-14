import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 🔴 ISSUE-071 / DEC-057 — THE GUARD THAT MAKES THE PROJECT SPLIT REAL.
 *
 * `vitest.config.ts` runs `*.integration.test.ts` single-threaded and
 * everything else in parallel, because integration files share ONE database.
 * That split is by FILENAME, which means it is only as good as an author
 * remembering the convention — and nine recorded incidents say conventions are
 * not remembered.
 *
 * So the convention is enforced here instead of documented. A test file that
 * constructs a `PrismaClient` without an `.integration.test.ts` name would
 * silently rejoin the PARALLEL pool and reopen ISSUE-071 with nothing to
 * notice, because it would still pass — most of the time.
 *
 * ⚠️ THIS IS THE PART OPTION C COULD NOT DO. A shared fixture helper
 * standardises the discipline; it does not detect the author who never used
 * it. This does.
 *
 * 🔴 It matches `new PrismaClient(` — CONSTRUCTION, never the type import.
 * Plenty of unit tests legitimately `import type { PrismaClient }` to type a
 * fake, and flagging those would make the guard cry wolf until it was ignored,
 * which is how a check dies.
 *
 * 🔴 ISSUE-074 — AND the shared-client import. A test can reach the database
 * two ways: build its own client, or `import { prisma } from '../lib/prisma'`
 * — the pattern the APPLICATION code uses, and therefore the one a new test
 * is most likely to copy. The original guard matched only the first, so the
 * likelier path was the unguarded one.
 *
 * ⚠️ THE SCANNED BOUNDARY IS `server/src/`, STATED DELIBERATELY (ISSUE-074's
 * second half). A database-touching test placed outside it — a future
 * `server/tests/`, or `server/prisma/` — is invisible to this guard. Today no
 * test lives outside `src/`; if one ever does, widen SRC with it.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url))
const CONSTRUCTS_CLIENT = /new\s+PrismaClient\s*\(/
/**
 * The shared singleton lives at `src/lib/prisma.ts`, so any specifier ending
 * in `/prisma` (with or without an extension) is that module. `@prisma/client`
 * does NOT match — its path segment is `/client` — and neither does a type
 * import from it; both are asserted below.
 */
const IMPORTS_SHARED_CLIENT = /from\s+['"][^'"]*\/prisma(?:\.js|\.ts)?['"]/

function testFilesUnder(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...testFilesUnder(full))
    } else if (entry.endsWith('.test.ts')) {
      found.push(full)
    }
  }
  return found
}

describe('🔴 every database-touching test file is named .integration.test.ts', () => {
  const files = testFilesUnder(SRC)

  it('finds test files at all — the guard must not pass by scanning nothing', () => {
    // Without this, a broken path would make the assertion below vacuously
    // true: an empty list has no offenders. All-pass and all-reject are
    // equally strong evidence of a broken check.
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => f.endsWith('.integration.test.ts'))).toBe(true)
  })

  it('no parallel-pool test file constructs OR imports a database client', () => {
    const offenders = files
      .filter((file) => !file.endsWith('.integration.test.ts'))
      // 🔴 This file itself, and ONLY this file. It contains the literal
      // `new PrismaClient(` and the literal shared-import specifier inside the
      // matchers' own positive cases below, so it matched itself on the first
      // run. Excluded by exact path rather than by a pattern, so the exemption
      // cannot quietly widen to cover a real offender later.
      .filter((file) => file !== fileURLToPath(import.meta.url))
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        return CONSTRUCTS_CLIENT.test(source) || IMPORTS_SHARED_CLIENT.test(source)
      })
      .map((file) => file.slice(SRC.length).replace(/\\/g, '/'))

    expect(
      offenders,
      'These reach the database (own PrismaClient or the shared lib/prisma ' +
        'singleton) but run in the PARALLEL pool, which is ISSUE-071. Rename ' +
        'them to *.integration.test.ts so vitest runs them single-threaded — ' +
        'see vitest.config.ts and DEC-057.',
    ).toEqual([])
  })

  it('🔴 the matcher recognises a real construction, and ignores a type import', () => {
    // The guard is confronted with both answers rather than trusted. A matcher
    // that can never fire looks identical to a codebase with no offenders —
    // this project has closed that exact defect before (the P2002 matcher).
    expect(CONSTRUCTS_CLIENT.test('const prisma = new PrismaClient({ adapter })')).toBe(true)
    expect(CONSTRUCTS_CLIENT.test('new  PrismaClient()')).toBe(true)
    expect(CONSTRUCTS_CLIENT.test("import type { PrismaClient } from '@prisma/client'")).toBe(false)
    expect(CONSTRUCTS_CLIENT.test('let prisma: PrismaClient')).toBe(false)
  })

  it('🔴 ISSUE-074 — the matcher recognises the SHARED-client import, both answers', () => {
    // The likelier path: copying the application's own import.
    expect(IMPORTS_SHARED_CLIENT.test("import { prisma } from '../lib/prisma.js'")).toBe(true)
    expect(IMPORTS_SHARED_CLIENT.test("import { prisma as appPrisma } from './prisma.js'")).toBe(true)
    expect(IMPORTS_SHARED_CLIENT.test('import { prisma } from "../../lib/prisma"')).toBe(true)
    // `@prisma/client` is the LIBRARY, not the shared singleton — its path
    // segment is `/client`. Flagging it would catch every legitimate fake.
    expect(IMPORTS_SHARED_CLIENT.test("import { PrismaClient } from '@prisma/client'")).toBe(false)
    expect(IMPORTS_SHARED_CLIENT.test("import type { PrismaClient } from '@prisma/client'")).toBe(false)
    expect(IMPORTS_SHARED_CLIENT.test("import { PrismaPg } from '@prisma/adapter-pg'")).toBe(false)
  })
})
