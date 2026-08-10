// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useUrlToken } from './useUrlToken.js'

/**
 * MILESTONE-006 clause H1 — a plaintext token must not survive in the URL.
 *
 * 🔴 The assertion that matters is on `window.location.search` AFTER the hook
 * runs. Asserting only that the token was read would pass while leaving it in
 * the address bar, in history, and in every Referer and analytics payload —
 * which is the entire defect H1 exists to prevent.
 */

function visit(url: string) {
  window.history.replaceState({}, '', url)
}

afterEach(() => {
  visit('/')
})

describe('useUrlToken — H1', () => {
  it('reads the token from the query string', () => {
    visit('/reset-password?token=abc123')
    const { result } = renderHook(() => useUrlToken())
    expect(result.current).toBe('abc123')
  })

  it('🔴 REMOVES the token from the address bar', () => {
    visit('/reset-password?token=abc123')
    renderHook(() => useUrlToken())

    expect(window.location.search).toBe('')
    expect(window.location.href).not.toContain('abc123')
  })

  it('🔴 keeps the path, so the user stays where the link sent them', () => {
    visit('/verify-email?token=abc123')
    renderHook(() => useUrlToken())
    expect(window.location.pathname).toBe('/verify-email')
  })

  it('🔴 preserves UNRELATED query parameters', () => {
    // Stripping the whole query string would be a blunter fix that silently
    // discards anything else the link carried.
    visit('/reset-password?token=abc123&lang=en')
    renderHook(() => useUrlToken())

    expect(window.location.search).toBe('?lang=en')
    expect(window.location.href).not.toContain('abc123')
  })

  it('🔴 uses replaceState, so no history entry holds the token', () => {
    // pushState would leave the token-bearing entry reachable with Back —
    // which is the thing being removed.
    const lengthBefore = window.history.length
    visit('/reset-password?token=abc123')
    renderHook(() => useUrlToken())

    expect(window.history.length).toBe(lengthBefore)
    expect(window.location.href).not.toContain('abc123')
  })

  it('returns null when there is no token, and leaves the URL alone', () => {
    visit('/reset-password')
    const { result } = renderHook(() => useUrlToken())

    expect(result.current).toBeNull()
    expect(window.location.pathname).toBe('/reset-password')
  })

  it('🔴 still returns the token after a re-render, once the URL is clean', () => {
    // The token lives in state, not in the URL — a re-render (or StrictMode's
    // double mount) must not lose it, or the form breaks on its own second
    // pass.
    visit('/reset-password?token=abc123')
    const { result, rerender } = renderHook(() => useUrlToken())
    rerender()

    expect(result.current).toBe('abc123')
    expect(window.location.search).toBe('')
  })
})
