/**
 * ISSUE-152 — the admin types whole shekels; the wire stays canonical.
 *
 * The server's price schema (adminProductForm.ts) is deliberately strict:
 * exactly two decimals, no leading zeros. The user's ask is that "190"
 * just works — so the CLIENT completes the agorot before sending:
 * "190" → "190.00", "190.5" → "190.50". Anything else (already-canonical,
 * or genuinely malformed) passes through untouched and the server's named
 * refusal stays the source of truth (§3.4 — this is convenience, not
 * validation).
 */
export function normalizePriceInput(raw: string): string {
  const value = raw.trim()
  if (/^\d+$/.test(value)) return `${value}.00`
  if (/^\d+\.\d$/.test(value)) return `${value}0`
  if (/^\d+\.$/.test(value)) return `${value}00`
  return value
}
