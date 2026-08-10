import argon2 from 'argon2'
import type { PrismaClient } from '@prisma/client'
import type { EmailService } from './emailService.js'
import { issueVerificationToken } from './verificationToken.js'
import type { RegistrationInput } from './registrationForm.js'

/**
 * MILESTONE-006 Checkpoint D — registration.
 *
 * The ordering below is DEC-053 Part 2, FROZEN and AMENDED. Read that entry
 * before changing anything here; two of its rules fail silently.
 */

/**
 * DEC-052 clause 1b — the parameters are part of the decision, because
 * wrapper defaults vary and some sit below the OWASP floor.
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const

/**
 * Clause A2's constant-time reasoning, applied to /register.
 *
 * The already-registered path (DEC-053 4b) skips user creation and password
 * hashing entirely, so it would return measurably faster and re-open by timing
 * the enumeration oracle that 4b closes by response shape. Hashing the
 * submitted password against a discarded result costs the same as the real
 * path.
 *
 * 🔴 This looks like pointless wasted work and is exactly the kind of thing an
 * optimisation pass deletes. It is load-bearing.
 */
async function burnEquivalentHashCost(password: string): Promise<void> {
  await argon2.hash(password, ARGON2_OPTIONS)
}

export interface RegistrationDeps {
  prisma: PrismaClient
  emailService: EmailService
  /** Absolute base URL used to build the emailed verification link. */
  appBaseUrl: string
  now?: () => Date
}

export interface RegistrationOutcome {
  /**
   * True when a new user row was committed. 🔴 NEVER exposed in the HTTP
   * response — DEC-053 4b requires the same 200 shape either way. It exists
   * so the route knows whether to regenerate the session, and so tests can
   * assert behaviour the response deliberately hides.
   */
  created: boolean
  userId: string | null
  /** Plaintext, for the emailed link only. Never stored, never logged. */
  verificationToken: string | null
}

/**
 * Steps 3 and 4 of DEC-053 Part 2: the transaction, then the commit.
 *
 * 🔴 Session regeneration is NOT here, deliberately. See the route.
 */
export async function registerUser(
  input: RegistrationInput & { phone: string },
  guestSessionId: string,
  deps: RegistrationDeps,
): Promise<RegistrationOutcome> {
  const now = deps.now?.() ?? new Date()

  const existing = await deps.prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  })

  if (existing) {
    // ── DEC-053 clause 4b — the already-registered path ──────────────────
    // 🔴 No 409, no "email already in use", no second user row. The caller
    // returns the SAME 200 shape as success. A distinguishable response makes
    // /register an account-enumeration oracle, and a friendlier one than
    // login, because it needs no password guess at all.
    await burnEquivalentHashCost(input.password)

    // The owner is told instead. Sent by the caller AFTER this returns, so it
    // stays outside any transaction (INV-04) — same as the success path.
    return { created: false, userId: null, verificationToken: null }
  }

  const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS)
  const token = issueVerificationToken(now)

  // ── DEC-053 Part 2 step 3: THE TRANSACTION ───────────────────────────────
  // 🔴 No external call and no session-store write inside it (INV-04).
  const user = await deps.prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        passwordHash,
        phone: input.phone,
        termsAcceptedAt: now, // Table 3 field 26 — record WHEN consent was given
        // status defaults to pending_verification (DEC-024). A9 blocks an
        // unverified account from completing an order; REQ-F-034 lets it
        // browse and use the cart.
      },
      select: { id: true },
    })

    await tx.emailVerificationToken.create({
      data: {
        userId: created.id,
        token: token.digest, // 🔴 A4 — the SHA-256 digest, never the plaintext
        expiresAt: token.expiresAt,
      },
    })

    // ══════════ SEAM: PROMOTE-GUEST-CART ══════════════════════════════════
    //
    // 🔴 DELIBERATELY EMPTY IN MILESTONE-006. Do not remove it.
    //
    // Owner:  REQ-F-020 · DEC-019 (registration branch) · MILESTONE-007.
    // M-007 promotes the guest cart here: find the Cart whose `session_id`
    // is `guestSessionId` and assign it to `created.id`.
    //
    // WHY IT IS INSIDE THE TRANSACTION: promotion is a Prisma write and must
    // roll back with the user creation. That is precisely why session
    // REGENERATION was moved OUT of the transaction (DEC-053 Rule 2) — the
    // two have opposite rollback needs and cannot sit together.
    //
    // 🔴 PRECONDITION M-007 INHERITS (open item O8): `guestSessionId` is only
    // meaningful if the guest session was persisted. `saveUninitialized` is
    // false, so an untouched session is never written and its id does not
    // recur. M-007 must write to `req.session` when it CREATES a guest cart.
    //
    // `guestSessionId` is referenced here so no unused-variable cleanup
    // deletes it before M-007 arrives.
    void guestSessionId

    return created
  })
  // ── Step 4: COMMITTED. Only now may the session be regenerated. ──────────

  return { created: true, userId: user.id, verificationToken: token.plaintext }
}

/** Built by the caller after the commit — never inside the transaction. */
export function buildVerificationEmail(baseUrl: string, plaintextToken: string) {
  const link = `${baseUrl.replace(/\/$/, '')}/verify-email?token=${plaintextToken}`
  return {
    subject: 'VitaShop — אימות כתובת המייל',
    body: [
      'ברוכים הבאים ל-VitaShop.',
      '',
      'כדי להשלים את ההרשמה, יש לאמת את כתובת המייל בקישור הבא:',
      link,
      '',
      'הקישור תקף ל-24 שעות וניתן לשימוש חד-פעמי בלבד.',
    ].join('\n'),
  }
}

/** DEC-053 4b — what the EXISTING owner receives instead. */
export function buildExistingAccountEmail(email: string) {
  return {
    to: email,
    subject: 'VitaShop — ניסיון הרשמה עם כתובת המייל שלך',
    body: [
      'מישהו ניסה להירשם ל-VitaShop עם כתובת המייל הזו, שכבר רשומה במערכת.',
      '',
      'לא נוצר חשבון חדש ולא בוצע שינוי בחשבון הקיים.',
      'אם זה היית את/ה — אפשר פשוט להתחבר.',
      'אם לא — אין צורך בפעולה כלשהי.',
    ].join('\n'),
  }
}
