import { describe, expect, it } from 'vitest'
import { parseTrustProxy } from './trustProxy.js'

/**
 * Both controls: values that MUST disable, values that MUST enable, and
 * values that MUST refuse — `true` in particular, because trusting the
 * whole chain reopens the IP-forgery hole the default guards against.
 */
describe('parseTrustProxy', () => {
  it('is OFF when unset, empty, 0, false or off (the local default)', () => {
    for (const raw of [undefined, '', '  ', '0', 'false', 'FALSE', 'off']) {
      expect(parseTrustProxy(raw)).toBe(false)
    }
  })

  it('is the proxy DEPTH as a number when set to a positive integer', () => {
    expect(parseTrustProxy('1')).toBe(1)
    expect(parseTrustProxy(' 2 ')).toBe(2)
  })

  it('refuses anything else, loudly — including "true"', () => {
    for (const raw of ['true', 'yes', '1.5', '-1', 'loopback, 1']) {
      expect(() => parseTrustProxy(raw)).toThrow(/TRUST_PROXY/)
    }
  })
})
