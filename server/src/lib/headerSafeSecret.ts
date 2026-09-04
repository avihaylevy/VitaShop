/**
 * ONE shape guard for every secret that travels in an HTTP header (the
 * Groq key, the Brevo key, the next one). Extracted 2026-09-04 when the
 * second copy appeared (review finding).
 *
 * 🔴 WHY IT EXISTS — a real leak path: a value carrying a stray control or
 * non-ASCII character (a CRLF paste artefact, a smart quote, a zero-width
 * space) makes Node's `Headers` constructor THROW with the header VALUE
 * inside the TypeError message, which the calling route would then
 * console.error — putting the key in the logs. Validating to printable
 * ASCII up front lets a selector fall back loudly WITHOUT ever printing
 * the value.
 */
export function isHeaderSafeSecret(value: string): boolean {
  return /^[\x21-\x7e]+$/.test(value)
}
