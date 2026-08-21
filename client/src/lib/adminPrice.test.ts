import { describe, expect, it } from 'vitest'
import { normalizePriceInput } from './adminPrice'

describe('normalizePriceInput — ISSUE-152', () => {
  it('completes whole shekels to canonical agorot', () => {
    expect(normalizePriceInput('190')).toBe('190.00')
    expect(normalizePriceInput(' 190 ')).toBe('190.00')
    expect(normalizePriceInput('0')).toBe('0.00')
  })

  it('pads a single decimal digit and a trailing point', () => {
    expect(normalizePriceInput('190.5')).toBe('190.50')
    expect(normalizePriceInput('190.')).toBe('190.00')
  })

  it('leaves canonical and malformed values untouched (the server decides)', () => {
    expect(normalizePriceInput('190.00')).toBe('190.00')
    expect(normalizePriceInput('00.50')).toBe('00.50')
    expect(normalizePriceInput('abc')).toBe('abc')
    expect(normalizePriceInput('190.123')).toBe('190.123')
    expect(normalizePriceInput('-5')).toBe('-5')
  })
})
