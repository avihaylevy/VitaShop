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
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
})
