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

  // 🔴 TWO NORMALISERS, because one was doing two incompatible jobs.
  //
  // STRUCTURED field names want underscores GONE, so a caller writing
  // `sessionId` matches a driver reporting `session_id`.
  // CONSTRAINT NAMES want them KEPT, because there they are the boundary.
  // A single normaliser that stripped both made the fallback's boundary regex
  // unmatchable: `normalise('users_email_key')` became `usersemailkey`, in
  // which `[^a-z0-9]` can never appear, so only the `^` alternative survived
  // and the branch could not fire for any real caller.
  const normaliseField = (value: string) => value.toLowerCase().replace(/_/g, '')
  const normaliseConstraint = (value: string) => value.toLowerCase()

  const structured = [...fields, ...target].map(normaliseField)
  if (structured.length > 0) {
    // 🔴 A STRUCTURED SOURCE THAT ANSWERED IS NOT SECOND-GUESSED BY TEXT.
    // Precise negative beats loose positive: a P2002 on
    // `users_pending_email_key` reports fields ['pending_email'], which
    // correctly does not match 'email'.
    return accepted.some((value) => structured.includes(normaliseField(value)))
  }

  // ── The fallback: ONLY when neither structured source yielded anything ──
  //
  // 🔴 IT MATCHES THE FULL CONSTRAINT NAME, EXACTLY. It deliberately does NOT
  // try to recover a COLUMN name from a constraint name, and that restriction
  // is a finding rather than laziness:
  //
  //   users_email_key          -> candidate columns: users_email, email
  //   users_pending_email_key  -> candidate columns: users_pending_email,
  //                               pending_email, EMAIL
  //
  // The table prefix is unknown, so `email` is a legitimate reading of BOTH.
  // Any rule permissive enough to accept 'email' for `users_email_key` also
  // accepts it for `users_pending_email_key` — which is precisely the
  // false-positive that made registration answer ALREADY-REGISTERED for an
  // unrelated collision. Name-only parsing cannot separate them.
  //
  // 🔴 THEREFORE: a caller that wants fallback coverage MUST list the
  // constraint name alongside its field names. Both call sites do
  // (`['email', 'users_email_key']`, `['carts_session_id_key', 'sessionId',
  // 'session_id']`). Field names alone are served by the structured path only.
  // 🔴 UNMISUSABLE, NOT MERELY DOCUMENTED, and checked HERE rather than at
  // entry — a caller passing only field names is perfectly correct as long as
  // the structured path answers, which it does under today's adapter. The
  // misuse only bites when the fallback is actually REACHED, so that is where
  // it must fail, and it fails LOUDLY.
  //
  // Without this, a third call site written as ['email'] would get a fallback
  // that can never match, with every test still green — the same silent-failure
  // shape this file has now produced three times.
  if (!accepted.some((value) => /_key$/i.test(value))) {
    throw new Error(
      'isUniqueViolationOn: the structured error data was empty, so the message fallback ran, ' +
        'but `accepted` lists no full constraint name (e.g. users_email_key) for it to match. ' +
        `Got: ${JSON.stringify(accepted)}`,
    )
  }

  const quoted = /unique constraint "([^"]+)"/i.exec(message)?.[1]
  if (!quoted) return false
  const quotedName = normaliseConstraint(quoted)
  return accepted.some((value) => normaliseConstraint(value) === quotedName)
}
