import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrevoEmailProvider } from './brevoEmailProvider.js'
import { resolveEmailProvider } from './emailProvider.js'
import { ConsoleEmailProvider } from './emailService.js'

/** Both controls per rule: a config that MUST select Brevo, and every way it must NOT. */
describe('resolveEmailProvider', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  afterEach(() => errorSpy.mockClear())

  it('unset or "console" → the console transport, silently (the local default)', () => {
    expect(resolveEmailProvider({})).toBeInstanceOf(ConsoleEmailProvider)
    expect(resolveEmailProvider({ EMAIL_PROVIDER: 'console' })).toBeInstanceOf(ConsoleEmailProvider)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('brevo with a key and a sender address → BrevoEmailProvider', () => {
    const provider = resolveEmailProvider({
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'xkeysib-abc',
      EMAIL_FROM_ADDRESS: 'sender@example.com',
    })
    expect(provider).toBeInstanceOf(BrevoEmailProvider)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('🔴 brevo WITHOUT a key falls back to console LOUDLY, and the log line carries nothing key-shaped', () => {
    const provider = resolveEmailProvider({ EMAIL_PROVIDER: 'brevo', EMAIL_FROM_ADDRESS: 'sender@example.com' })
    expect(provider).toBeInstanceOf(ConsoleEmailProvider)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(String(errorSpy.mock.calls[0]?.[0])).toMatch(/BREVO_API_KEY is not set/)
  })

  it('a key with a line break (paste artefact) or a bad sender address also falls back, without printing the key', () => {
    const badKey = resolveEmailProvider({
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'xkeysib-abc\n',
      EMAIL_FROM_ADDRESS: 'sender@example.com',
    })
    // trim() removes the trailing newline, so an INNER control char is the real case:
    const innerBad = resolveEmailProvider({
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'xkeysib​abc',
      EMAIL_FROM_ADDRESS: 'sender@example.com',
    })
    const badFrom = resolveEmailProvider({
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'xkeysib-abc',
      EMAIL_FROM_ADDRESS: 'not-an-address',
    })
    expect(badKey).toBeInstanceOf(BrevoEmailProvider) // trimmed → valid
    expect(innerBad).toBeInstanceOf(ConsoleEmailProvider)
    expect(badFrom).toBeInstanceOf(ConsoleEmailProvider)
    for (const call of errorSpy.mock.calls) {
      expect(String(call[0])).not.toMatch(/xkeysib/)
    }
  })

  it('an unknown value names itself and uses console', () => {
    expect(resolveEmailProvider({ EMAIL_PROVIDER: 'sendgrid' })).toBeInstanceOf(ConsoleEmailProvider)
    expect(String(errorSpy.mock.calls[0]?.[0])).toMatch(/"sendgrid" is not a known transport/)
  })
})
