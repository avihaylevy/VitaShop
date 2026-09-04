import type { EmailMessage, EmailService } from './emailService.js'

/**
 * DEC-117 (2026-09-04) — REAL DELIVERY for the live copy, through Brevo's
 * transactional HTTP API. Chosen over Resend because Brevo delivers to
 * anyone from a verified sender ADDRESS with no domain to own (it swaps in
 * a compliant From when the sender is a free-mail address); Resend without
 * a domain can only deliver to the account owner. Free tier: 300/day.
 *
 * DEC-007 still stands: the LOGIC (tokens, expiry, gates) is unchanged and
 * the console provider stays the default. This is the "swap of
 * implementation plus an environment variable" emailService.ts promised.
 *
 * 🔴 THE KEY IS THE USER'S (DEC-014, quality/SECRETS_AND_KEYS.md): placed by
 * them in the host's environment; an agent never obtains or configures it.
 *
 * 🔴 NOTHING ABOUT A MESSAGE IS EVER LOGGED HERE. The body carries the
 * plaintext verification / reset token (clause A4 forbids logging it), and
 * the console provider's licence to print it rests on the console being a
 * developer's own terminal. An error from this class names the HTTP status
 * and Brevo's error code — never the recipient, subject, body or key.
 *
 * No npm dependency: Node's built-in fetch, one endpoint, one JSON shape.
 */

export const BREVO_SEND_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

/** Brevo answers in well under a second; anything longer is a stuck call. */
export const BREVO_TIMEOUT_MS = 10_000

export interface BrevoEmailProviderOptions {
  apiKey: string
  fromEmail: string
  fromName: string
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

export class BrevoEmailProvider implements EmailService {
  private readonly apiKey: string
  private readonly fromEmail: string
  private readonly fromName: string
  private readonly fetchImpl: typeof fetch

  constructor(options: BrevoEmailProviderOptions) {
    this.apiKey = options.apiKey
    this.fromEmail = options.fromEmail
    this.fromName = options.fromName
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetchImpl(BREVO_SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: this.fromName, email: this.fromEmail },
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.body,
      }),
      signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
    })
    if (response.ok) return
    // Brevo's error body is `{ code, message }`; the code is safe to
    // surface ("unauthorized", "invalid_parameter"), the message may quote
    // our payload, so only the code travels.
    let code = 'unknown'
    try {
      const parsed: unknown = await response.json()
      if (parsed && typeof parsed === 'object' && typeof (parsed as { code?: unknown }).code === 'string') {
        code = (parsed as { code: string }).code
      }
    } catch {
      // a non-JSON error body: the status alone is the diagnosis
    }
    throw new Error(`Brevo refused the message: HTTP ${response.status} (${code})`)
  }
}
