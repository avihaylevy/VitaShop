import { z } from 'zod'

/**
 * REQ-F-030 / Table 3 — the seven registration fields, validated SERVER-SIDE.
 *
 * 🔴 §3.4: the client is not a source of truth. Every rule here is enforced
 * again on the server even though the form checks it too — VALIDATION_RULES.md
 * field 24 says so explicitly ("a client-only check is not enforcement").
 */

/** Table 3 field 23: >= 8 characters, at least one uppercase, at least one digit. */
const passwordSchema = z
  .string()
  // 🔴 A minimum, not a maximum (VALIDATION_RULES.md field 23). No upper
  // length cap beyond a sanity bound, and no forbidden characters — both
  // weaken passwords and both are common "hardening" mistakes.
  .min(8, 'PASSWORD_TOO_SHORT')
  .max(200, 'PASSWORD_TOO_LONG')
  .refine((value) => /[A-Z]/.test(value), 'PASSWORD_NEEDS_UPPERCASE')
  .refine((value) => /[0-9]/.test(value), 'PASSWORD_NEEDS_DIGIT')

/**
 * Table 3 field 25 — Israeli mobile format. VALIDATION_RULES.md marks the
 * exact format `Proposed` (ISSUE-009) and suggests `05X-XXXXXXX` or
 * `05XXXXXXXX`, normalised before storage. Both accepted; normalised to
 * digits-only on the way in.
 */
const PHONE_PATTERN = /^05\d-?\d{7}$/

export function normalisePhone(raw: string): string {
  return raw.replace(/-/g, '')
}

export const registrationSchema = z
  .object({
    firstName: z.string().trim().min(1, 'FIRST_NAME_REQUIRED'),
    lastName: z.string().trim().min(1, 'LAST_NAME_REQUIRED'),
    email: z.string().trim().toLowerCase().email('EMAIL_INVALID'),
    password: passwordSchema,
    confirmPassword: z.string(),
    phone: z.string().trim().regex(PHONE_PATTERN, 'PHONE_INVALID'),
    // Table 3 field 26 — must be exactly `true`. `false` or absent rejects.
    acceptedTerms: z.literal(true, {
      message: 'TERMS_REQUIRED',
    }),
  })
  // Field 24, checked server-side.
  .refine((data) => data.password === data.confirmPassword, {
    message: 'PASSWORD_CONFIRMATION_MISMATCH',
    path: ['confirmPassword'],
  })

export type RegistrationInput = z.infer<typeof registrationSchema>

export interface RegistrationParseFailure {
  ok: false
  fields: string[]
  codes: string[]
}

export interface RegistrationParseSuccess {
  ok: true
  value: RegistrationInput & { phone: string }
}

export function parseRegistration(
  raw: unknown,
): RegistrationParseSuccess | RegistrationParseFailure {
  const result = registrationSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
    return {
      ok: false,
      fields: [...new Set(issues.map((issue) => issue.path.join('.')).filter(Boolean))],
      codes: [...new Set(issues.map((issue) => issue.message))],
    }
  }

  return {
    ok: true,
    value: { ...result.data, phone: normalisePhone(result.data.phone) },
  }
}
