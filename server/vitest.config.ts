import { defineConfig, configDefaults } from 'vitest/config'

/**
 * 🔴 The server had NO vitest config until 2026-08-11 (MILESTONE-004 Part 2,
 * batch 1). It ran on defaults, and one default changed underneath it.
 *
 * THE DEFECT (ISSUE-043). `npm run build` is `tsc -b`, which emits compiled
 * tests to `dist/src/**\/*.test.js`. Vitest 3 excluded `**\/dist/**` by
 * default; **Vitest 4 removed that entry**. This project is on 4.1.10, so the
 * suite was collecting every test TWICE — once from `src/` and once from a
 * compiled copy in `dist/` — and reporting 818 tests where the real number is
 * 409.
 *
 * WHY THAT IS WORSE THAN NOISE. `dist/` is a SNAPSHOT from whenever someone
 * last ran a build, and it is git-ignored, so its staleness is invisible:
 *
 *   · A test DELETED from source keeps passing from `dist/`. Removing a test
 *     file — or renaming one — leaves the old copy still reported green, so
 *     coverage can silently shrink while the suite says otherwise. This is
 *     the one that can actually hide something.
 *   · The counts are not comparable between machines. A checkout that has
 *     never been built runs 409; one that has runs 818. Any test-count
 *     assertion, or any human reading "818 passed" as coverage, is misled —
 *     as every server-suite figure recorded before this config was.
 *   · Failures became ambiguous. A red run gave no signal whether SOURCE or a
 *     stale artifact broke. Batch 1 hit this twice: two genuinely stale
 *     assertions reported as four failures, half of them citing line numbers
 *     in a file nobody can edit.
 *
 * ⚠️ What this is NOT. The first version of this note claimed a `dist/` built
 * before a regression could let a broken change land inside a green run. That
 * is wrong — if the SOURCE test fails, the run is red no matter what the
 * stale copy does. Any failure fails the run. The danger is deletion and
 * ambiguity, not concealment of a live failure.
 *
 * `dist/` is BUILD OUTPUT. It is never the thing under test — the source is.
 * Deleting the directory is not the fix, because the mandated `npm run build`
 * recreates it immediately.
 *
 * ⚠️ `configDefaults.exclude` is spread rather than retyped, so this only
 * ADDS to whatever the installed Vitest already excludes. Hardcoding the list
 * would freeze today's defaults and reintroduce this same class of silent
 * drift at the next major version — which is precisely how this happened.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 🔴 ISSUE-071 — TWO PROJECTS, AND THE INTEGRATION ONE IS SINGLE-THREADED.
 * Added 2026-08-12. DEC-057, option B, chosen by the user.
 *
 * THE DEFECT. Every integration file talks to ONE shared PostgreSQL database,
 * and vitest runs files in PARALLEL WORKERS by default. Nine recorded
 * incidents came from that and every one was patched individually — a fixture
 * prefix here, a retry there, a narrowed delete elsewhere. Measured on an
 * UNCHANGED tree immediately before this change: **3 of 10 runs RED**, in two
 * distinct shapes —
 *
 *   · a cleanup hook doing `findMany` by shared prefix and then `delete` per
 *     id, while another worker deletes the same row (a check-then-act race,
 *     structurally identical to the check-then-create race DEC-055 fixed in
 *     the cart), and
 *   · genuine ASSERTION failures in the cart journey, where a sibling suite
 *     mutated the same carts mid-test.
 *
 * 🔴 THE POINT IS THAT IT FIXES THE CLASS. Per-instance remedies require every
 * future test author to know an unwritten convention, and the incident count
 * says that does not hold. Serialising the files that share the database
 * removes the concurrency the whole family depends on.
 *
 * WHY NOT SERIALISE EVERYTHING. Unit tests — the large majority — touch no
 * database and lose nothing by running in parallel. Serialising them would pay
 * for isolation nowhere needed. Only the integration project sets
 * `fileParallelism: false`.
 *
 * 🔴 THE SPLIT IS BY FILENAME, AND THAT IS ONLY SAFE BECAUSE IT IS ENFORCED.
 * `src/lib/dbTestNaming.test.ts` fails if any test file constructs a
 * `PrismaClient` without an `.integration.test.ts` name. Without that guard a
 * new DB-touching test could silently rejoin the parallel pool and reopen this
 * issue with nothing to notice — the convention-you-must-remember weakness
 * that ruled out option C.
 *
 * ⚠️ EXISTING PER-INSTANCE REMEDIES ARE DELIBERATELY LEFT IN PLACE — the
 * `zz-` fixture prefixes, the crash-safe repair, the scoped deletes, the
 * session-store retry. Several look redundant now. None was removed: some
 * carry coverage for other reasons (the soft-delete probe is INV-03's), and
 * removing a guard because a different guard now exists is how coverage
 * disappears silently.
 */

/** Shared by both projects, so neither can drift from ISSUE-043's fix. */
const exclude = [...configDefaults.exclude, '**/dist/**']

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          exclude: [...exclude, '**/*.integration.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['**/*.integration.test.ts'],
          exclude,
          // 🔴 THE FIX. One shared database, so one file at a time.
          fileParallelism: false,
        },
      },
    ],
  },
})
