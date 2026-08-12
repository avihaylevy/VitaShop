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
  const message = String(cause?.originalMessage ?? '').toLowerCase()

  const haystack = [...fields, ...target].map((value) => value.toLowerCase())
  return accepted.some((value) => {
    const needle = value.toLowerCase()
    return haystack.includes(needle) || (message.length > 0 && message.includes(needle))
  })
}
