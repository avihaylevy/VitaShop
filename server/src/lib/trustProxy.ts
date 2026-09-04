/**
 * DEC-116 (2026-09-04) — `trust proxy` becomes an ENVIRONMENT decision.
 *
 * Locally there is no proxy, and trusting X-Forwarded-For would let any
 * caller forge an IP and get a fresh rate-limit bucket per request — so
 * the default is OFF (index.ts's original decision, unchanged). Behind
 * Render's proxy the opposite failure applies: with it off every visitor
 * reads as the proxy's address, all users share ONE limiter bucket, and
 * the login limiter blocks everyone or nobody. The Secure cookie flag
 * has the same dependency (technical/DEPLOYMENT.md traps 4 and 6).
 *
 * The value is the PROXY DEPTH, never `true`: `true` trusts the whole
 * chain, which is the forgery hole again from the other side.
 *
 * Pure so the parse is unit-pinnable; index.ts only applies the result.
 */
export function parseTrustProxy(raw: string | undefined): false | number {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === '' || value === '0' || value === 'false' || value === 'off') return false
  if (/^[1-9]\d*$/.test(value)) return Number(value)
  throw new Error(
    `TRUST_PROXY must be unset, 0/false, or the number of proxies in front of the server (e.g. 1) — got "${raw}".`,
  )
}
