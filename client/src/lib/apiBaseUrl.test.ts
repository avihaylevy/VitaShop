import { afterEach, describe, expect, it, vi } from 'vitest'
import { getApiBaseUrl, SAME_ORIGIN } from './apiBaseUrl.js'

describe('getApiBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns ok:true with the configured value', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000')
    expect(getApiBaseUrl()).toEqual({ ok: true, value: 'http://localhost:3000' })
  })

  it('DEC-116: "same-origin" resolves to an EMPTY base, so `${base}/api/x` is a relative /api/x', () => {
    vi.stubEnv('VITE_API_BASE_URL', SAME_ORIGIN)
    expect(getApiBaseUrl()).toEqual({ ok: true, value: '' })
  })

  it('returns ok:false with reason "missing-config" when unset', () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    expect(getApiBaseUrl()).toEqual({ ok: false, reason: 'missing-config' })
  })

  it('never throws, configured or not', () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    expect(() => getApiBaseUrl()).not.toThrow()
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000')
    expect(() => getApiBaseUrl()).not.toThrow()
  })

  it('importing the module never throws, even with no configuration', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    vi.resetModules()
    await expect(import('./apiBaseUrl.js')).resolves.toBeDefined()
  })
})
