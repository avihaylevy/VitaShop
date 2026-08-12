/**
 * 🔴 ONE P2002 constraint-matcher, for the whole server.
 *
 * TWO DETECTORS FOR ONE FACT IS HOW A SECURITY CONTROL DIED. `cartService`
 * learned the pg driver adapter's real error shape at MILESTONE-007 Checkpoint
 * D; `registrationService` kept the documented one — and only the second
 * guarded a security property. This module exists so that cannot recur.
 *
 * ⚠️ `meta.target` is what Prisma's documentation describes and is **absent
 * under the pg driver adapter this project uses**. Probed against a real
 * duplicate insert on 2026-08-12:
 *
 *   code P2002
 *   meta { modelName, driverAdapterError: { cause: {
 *           originalMessage: 'duplicate key value violates unique constraint
 *                             "users_email_key"',
 *           constraint: { fields: ['email'] } } } }
 *
 * 🔴 BOTH lookups are kept. The adapter may change, or be removed; a matcher
 * that understands exactly one shape is precisely what broke here.
 *
 * 🔴 THE NARROWNESS IS THE POINT AND MUST SURVIVE. It matches the named
 * constraint ONLY. A broad "any P2002" catch turns a database outage into a
 * fake success and loses a registration silently — worse than the 500 it
 * replaces.
 */
export function isUniqueViolationOn(error: unknown, accepted: readonly string[]): boolean {
  if (typeof error !== 'object' || error === null) return false

  const candidate = error as {
    code?: unknown
    meta?: {
      target?: unknown
      driverAdapterError?: {
        cause?: { originalMessage?: unknown; constraint?: { fields?: unknown } }
      }
    }
  }
  if (candidate.code !== 'P2002') return false

  const meta = candidate.meta ?? {}
  const cause = meta.driverAdapterError?.cause

  const fields = Array.isArray(cause?.constraint?.fields) ? cause.constraint.fields.map(String) : []
  const target =
    typeof meta.target === 'string'
      ? [meta.target]
      : Array.isArray(meta.target)
        ? meta.target.map(String)
        : []
  const message = String(cause?.originalMessage ?? '')

  // 🔴 NORMALISED ON BOTH SIDES. `fields` arrives as snake_case (`session_id`)
  // while callers naturally write camelCase (`sessionId`), so a caller that
  // passed only one spelling silently never matched. Depending on every caller
  // to list every spelling is how the first divergence started.
  const normalise = (value: string) => value.toLowerCase().replace(/_/g, '')

  const structured = [...fields, ...target].map(normalise)
  if (structured.length > 0) {
    // 🔴 A STRUCTURED SOURCE THAT ANSWERED IS NOT SECOND-GUESSED BY TEXT.
    // This used to OR the message test in unconditionally, so a PRECISE
    // NEGATIVE was overridden by a LOOSE POSITIVE: a P2002 on a
    // `users_pending_email_key` constraint has fields ['pending_email'],
    // which correctly does NOT match 'email' — but the raw message contains
    // "email", so the matcher said yes and registration would answer
    // ALREADY-REGISTERED for a collision that has nothing to do with the
    // address. That is this module's own header violated: a broad catch
    // turning a real error into a fake success and losing the registration.
    return accepted.some((value) => structured.includes(normalise(value)))
  }

  // Only when NEITHER structured source yielded anything. Matched on the
  // QUOTED CONSTRAINT NAME with a boundary, never a bare substring — Postgres
  // renders it as: duplicate key value violates unique constraint "name_key"
  const quoted = /unique constraint "([^"]+)"/i.exec(message)?.[1]
  if (!quoted) return false
  const quotedNormalised = normalise(quoted)
  return accepted.some((value) => {
    const needle = normalise(value)
    // Exact, or the constraint name is the accepted name plus Postgres'
    // conventional decoration (`users_email_key` for `email`). Not a substring
    // sweep: `pending_email` must not match `email`.
    return (
      quotedNormalised === needle ||
      new RegExp(`(^|[^a-z0-9])${needle}(key|idx|unique)?$`).test(quotedNormalised)
    )
  })
}
