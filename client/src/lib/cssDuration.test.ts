import { describe, expect, it } from 'vitest'
import { parseCssDuration } from './cssDuration'

/**
 * The pure half of reading --dur at runtime. getComputedStyle lives in
 * hooks/usePresence.ts; only the parsing is testable in the `node`
 * environment, so only the parsing is here.
 */

const FALLBACK = 200

describe('parseCssDuration', () => {
  it('parses milliseconds', () => {
    expect(parseCssDuration('200ms', FALLBACK)).toBe(200)
    expect(parseCssDuration('150ms', FALLBACK)).toBe(150)
  })

  it('parses seconds as milliseconds', () => {
    expect(parseCssDuration('0.2s', FALLBACK)).toBe(200)
    expect(parseCssDuration('1s', FALLBACK)).toBe(1000)
  })

  /**
   * Not hypothetical: Tailwind normalises `--dur: 200ms` to `.2s` in the
   * built stylesheet, so this leading-dot form is what getComputedStyle
   * actually returns in production. An earlier pattern requiring a leading
   * digit rejected it and fell back silently.
   */
  it('parses a leading-dot decimal, the form Tailwind actually emits', () => {
    expect(parseCssDuration('.2s', FALLBACK)).toBe(200)
    expect(parseCssDuration('.15s', FALLBACK)).toBe(150)
  })

  /** getPropertyValue returns the raw declaration, whitespace included. */
  it('tolerates surrounding whitespace', () => {
    expect(parseCssDuration('  200ms  ', FALLBACK)).toBe(200)
    expect(parseCssDuration('\n0.2s\n', FALLBACK)).toBe(200)
  })

  it('is case-insensitive about the unit', () => {
    expect(parseCssDuration('200MS', FALLBACK)).toBe(200)
    expect(parseCssDuration('0.2S', FALLBACK)).toBe(200)
  })

  /**
   * An undefined custom property yields '' from getPropertyValue. The
   * fallback is what keeps the exit timeout finite rather than 0, which
   * would unmount the drawer before it could animate.
   */
  it('falls back when the property is missing or empty', () => {
    expect(parseCssDuration('', FALLBACK)).toBe(FALLBACK)
    expect(parseCssDuration('   ', FALLBACK)).toBe(FALLBACK)
  })

  it('falls back on values that are not durations', () => {
    expect(parseCssDuration('abc', FALLBACK)).toBe(FALLBACK)
    expect(parseCssDuration('var(--dur)', FALLBACK)).toBe(FALLBACK)
    // A bare number is not a valid CSS <time>; guessing a unit would be wrong.
    expect(parseCssDuration('200', FALLBACK)).toBe(FALLBACK)
  })

  it('falls back on negative durations', () => {
    expect(parseCssDuration('-200ms', FALLBACK)).toBe(FALLBACK)
  })

  /** A deliberate 0ms is legitimate and must not be replaced by the fallback. */
  it('accepts an explicit zero', () => {
    expect(parseCssDuration('0ms', FALLBACK)).toBe(0)
    expect(parseCssDuration('0s', FALLBACK)).toBe(0)
  })
})
