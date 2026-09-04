import { describe, expect, it, vi } from 'vitest'
import { BREVO_SEND_ENDPOINT, BrevoEmailProvider } from './brevoEmailProvider.js'

const message = {
  to: 'someone@example.com',
  subject: 'VitaShop — אימות',
  body: 'https://vitashop.onrender.com/verify-email?token=PLAINTEXT-TOKEN-123',
}

function providerWith(response: Response) {
  const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch
  const provider = new BrevoEmailProvider({
    apiKey: 'xkeysib-test',
    fromEmail: 'sender@example.com',
    fromName: 'VitaShop',
    fetchImpl,
  })
  return { provider, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn> }
}

describe('BrevoEmailProvider', () => {
  it('POSTs the one Brevo shape: api-key header, sender, to, subject, textContent, with a timeout signal', async () => {
    const { provider, fetchImpl } = providerWith(new Response('{"messageId":"<x>"}', { status: 201 }))
    await provider.send(message)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(BREVO_SEND_ENDPOINT)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['api-key']).toBe('xkeysib-test')
    expect(JSON.parse(String(init.body))).toEqual({
      sender: { name: 'VitaShop', email: 'sender@example.com' },
      to: [{ email: 'someone@example.com' }],
      subject: message.subject,
      textContent: message.body,
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('🔴 a refusal throws with the status and Brevo code only — never the key, the recipient or the body (the token)', async () => {
    const { provider } = providerWith(
      new Response('{"code":"unauthorized","message":"Key not found"}', { status: 401 }),
    )
    let thrown: unknown
    try {
      await provider.send(message)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    const text = String((thrown as Error).message)
    expect(text).toMatch(/HTTP 401 \(unauthorized\)/)
    expect(text).not.toMatch(/xkeysib|someone@|PLAINTEXT-TOKEN|Key not found/)
  })

  it('a non-JSON error body still yields the status (the control: nothing swallowed as success)', async () => {
    const { provider } = providerWith(new Response('<html>502</html>', { status: 502 }))
    await expect(provider.send(message)).rejects.toThrow(/HTTP 502 \(unknown\)/)
  })
})
