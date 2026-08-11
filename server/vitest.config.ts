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
 *   · Edit a test, rerun the suite, and the stale `dist/` copy still fails —
 *     against source that no longer exists. Batch 1 hit exactly this: two
 *     genuinely stale assertions reported as four failures, two of them
 *     pointing at line numbers in a file nobody can edit.
 *   · The reverse is worse. A `dist/` built before a regression was
 *     introduced keeps passing, so a broken change can land inside a green-
 *     looking run.
 *   · The counts are not comparable between machines. A checkout that has
 *     never been built runs 409; one that has runs 818. Any test-count
 *     assertion, or any human reading "818 passed" as coverage, is misled.
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
