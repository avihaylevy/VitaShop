/**
 * Parses a CSS <time> into milliseconds. DOM-free: the getComputedStyle
 * call that supplies the string lives in hooks/usePresence.ts.
 *
 * Why this exists at all: the drawer's exit timeout must agree with the
 * CSS transition it is waiting on. Hard-coding 200 in JavaScript next to
 * `--dur: 200ms` in CSS is the two-sources-of-truth failure
 * DESIGN_SYSTEM.md §14 names — change one, and the drawer either unmounts
 * mid-slide or hangs after it. Reading the token keeps a single source.
 */

/**
 * Matches a CSS <time>: a number followed by ms or s.
 *
 * `\d*\.?\d+` and not `\d+(\.\d+)?` because the leading digit is genuinely
 * optional in practice — Tailwind normalises `--dur: 200ms` to `.2s` in the
 * built stylesheet, and that is the exact string getComputedStyle returns.
 * A pattern requiring a leading digit silently rejected it and fell back.
 */
const CSS_TIME = /^(\d*\.?\d+)(ms|s)$/i

export function parseCssDuration(value: string, fallbackMs: number): number {
  const match = CSS_TIME.exec(value.trim())
  if (!match) return fallbackMs

  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return fallbackMs

  return match[2]?.toLowerCase() === 's' ? amount * 1000 : amount
}
