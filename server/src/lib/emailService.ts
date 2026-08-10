/**
 * ARCH-002 / DEC-007 — the single email interface.
 *
 * 🔴 DEC-007's point, restated because it is the one that gets lost:
 * *simulated means the DELIVERY, not the logic.* Token single-use, the 24-hour
 * expiry and the order gate are all fully real; only the transport is a
 * console write. Moving to SMTP is a swap of implementation plus an
 * environment variable — no caller changes.
 *
 * 🔴 Every send happens OUTSIDE the database transaction, after the commit
 * (INV-04, clause A9). Callers own that ordering; this module cannot enforce
 * it, so the rule is stated at each call site too.
 */

export interface EmailMessage {
  to: string
  subject: string
  body: string
}

export interface EmailService {
  send(message: EmailMessage): Promise<void>
}

/**
 * DEC-007's first implementation: prints the message, including the
 * verification link, so a developer can complete the flow locally.
 *
 * 🔴 This is the ONLY place a plaintext verification token is allowed to
 * appear (clause A4 stores a SHA-256 digest and never logs the plaintext).
 * That is acceptable because the console is a developer's own terminal and
 * DEC-007 makes it the transport. It becomes unacceptable the moment output
 * is shipped anywhere durable — a log aggregator, a CI artefact, a bug report.
 */
export class ConsoleEmailProvider implements EmailService {
  async send(message: EmailMessage): Promise<void> {
    console.log(
      [
        '',
        '──────── EMAIL (ConsoleEmailProvider — DEC-007, delivery simulated) ────────',
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        '',
        message.body,
        '────────────────────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    )
  }
}

/** A no-op used by tests that must not print. Not for production use. */
export class NullEmailProvider implements EmailService {
  async send(): Promise<void> {
    // intentionally empty
  }
}
