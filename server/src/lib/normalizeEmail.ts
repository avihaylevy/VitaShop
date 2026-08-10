/**
 * The ONE email normalisation used everywhere an address is stored or looked
 * up: registration, login, and password reset.
 *
 * 🔴 Why this exists as a module rather than inline at each call site.
 * Registration stores the normalised form; login and reset look up by it. If
 * any one of the three normalises differently, the account it creates or finds
 * is not the account the others see — and the failure is silent. A user
 * registered as `Moshe@Example.com` who cannot log in as `moshe@example.com`
 * gets "email or password is incorrect" (A1's message, correctly), with
 * nothing anywhere pointing at the real cause.
 *
 * There were two copies before Checkpoint E's review — zod's
 * `.trim().toLowerCase()` in registration and an inline equivalent in login.
 * They agreed, so there was no bug; Checkpoint F would have been the third.
 *
 * 🔴 Deliberately conservative: trim and lowercase, nothing else. No
 * gmail-style dot-stripping and no `+tag` removal — both change which mailbox
 * an address refers to, and treating `a+shop@x.com` as `a@x.com` would let one
 * registration block another person's real address.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}
