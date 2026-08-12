import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 🔴 WIRING for `scripts/check-catalogue-facts.py`. Without this, the checker is
 * "a rule with extra steps" — a script nobody runs.
 *
 * `operations/ROADMAP.md` went stale twice while its own detail blocks were
 * current. Three written instructions on the subject already exist and the
 * first two were followed literally while the file still lied, so the
 * counter-move is structural: the numbers live in ONE marked block, and this
 * test fails the server suite when that block stops matching products.csv.
 *
 * ⚠️ SKIPS, LOUDLY, when the memory system is not on this machine. The
 * operations files live outside the repository, so a checkout without them
 * cannot verify anything — and a test that silently passed in that case would
 * be the vacuous shape this project keeps producing. It prints why it skipped.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')
const script = path.join(repoRoot, 'scripts', 'check-catalogue-facts.py')

function runChecker(): { ok: boolean; output: string } {
  try {
    const output = execFileSync('python', [script], { encoding: 'utf-8', stdio: 'pipe' })
    return { ok: true, output }
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string }
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` || err.message }
  }
}

describe('operations files state the real catalogue numbers', () => {
  it('🔴 the CATALOGUE-FACTS block matches products.csv', () => {
    const { ok, output } = runChecker()

    // 🔴 The checker SKIPS (exit 0) when VITASHOP_MEMORY_DIR is unset, so a
    // machine without the memory system reports a loud skip rather than a
    // failure — and this test surfaces that skip instead of swallowing it.
    if (/SKIPPED/.test(output)) {
      console.warn(`[catalogueFacts] the checker skipped:
${output}`)
      expect(true).toBe(true)
      return
    }

    if (!ok && /MISSING — cannot verify|No such file|cannot find the path/i.test(output)) {
      console.warn(
        `[catalogueFacts] SKIPPED — the memory system is not present on this machine.\n${output}`,
      )
      expect(true).toBe(true)
      return
    }

    // The failure message is the point: it names the file, the line, the
    // stated value and the computed one.
    expect(ok, `\n${output}`).toBe(true)
  })
})
