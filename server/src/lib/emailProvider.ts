import { BrevoEmailProvider } from './brevoEmailProvider.js'
import { ConsoleEmailProvider, type EmailService } from './emailService.js'

/**
 * DEC-117 — EMAIL_PROVIDER selects the transport at startup, the way
 * AI_PROVIDER selects the agent's provider (lib/ai/provider.ts):
 *
 *   unset / console   ConsoleEmailProvider (DEC-007; local, tests, Compose)
 *   brevo             BrevoEmailProvider, needs BREVO_API_KEY and
 *                     EMAIL_FROM_ADDRESS (a sender verified in Brevo);
 *                     EMAIL_FROM_NAME optional
 *
 * 🔴 NEVER REFUSES TO BOOT over an email config (the same invariant the AI
 * selector defends): a selection that cannot be honoured falls back to the
 * console transport LOUDLY, and nothing key-shaped is ever printed.
 */
export function resolveEmailProvider(env: NodeJS.ProcessEnv = process.env): EmailService {
  const configured = (env.EMAIL_PROVIDER ?? '').trim().toLowerCase()
  switch (configured) {
    case 'brevo': {
      const apiKey = (env.BREVO_API_KEY ?? '').trim()
      const fromEmail = (env.EMAIL_FROM_ADDRESS ?? '').trim()
      const fromName = (env.EMAIL_FROM_NAME ?? '').trim() || 'VitaShop'
      if (apiKey === '') {
        console.error('[email] EMAIL_PROVIDER=brevo but BREVO_API_KEY is not set — falling back to the console transport')
        break
      }
      // Same shape guard as the Groq key (lib/ai/provider.ts): a stray
      // control or non-ASCII character makes the Headers constructor throw
      // with the VALUE in the message, which a caller would then log.
      if (!/^[\x21-\x7e]+$/.test(apiKey)) {
        console.error(
          '[email] EMAIL_PROVIDER=brevo but BREVO_API_KEY contains characters that cannot travel in an HTTP header (re-paste it without quotes or line breaks) — falling back to the console transport',
        )
        break
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
        console.error(
          '[email] EMAIL_PROVIDER=brevo but EMAIL_FROM_ADDRESS is not an email address — falling back to the console transport',
        )
        break
      }
      return new BrevoEmailProvider({ apiKey, fromEmail, fromName })
    }
    case '':
    case 'console':
      break
    default:
      console.error(`[email] EMAIL_PROVIDER="${configured}" is not a known transport — using the console transport`)
  }
  return new ConsoleEmailProvider()
}
