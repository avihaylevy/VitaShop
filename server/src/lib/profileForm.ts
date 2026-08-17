import { z } from 'zod'
import { PHONE_PATTERN, normalisePhone } from './registrationForm.js'

/**
 * MILESTONE-009 / DEC-090 — the profile edit (REQ-F-051 "update personal
 * details"). Table 3's rules, the registration form's exact vocabulary
 * and phone pattern — one rule, two surfaces.
 *
 * 🔴 EMAIL IS ABSENT BY DECISION (DEC-090 O2): the sign-in identity and
 * verified anchor. `.strict()` makes a body carrying it a named refusal
 * rather than a silent ignore.
 */
export const profilePatchSchema = z
  .object({
    firstName: z.string({ message: 'FIRST_NAME_REQUIRED' }).trim().min(1, 'FIRST_NAME_REQUIRED').max(100, 'FIRST_NAME_REQUIRED'),
    lastName: z.string({ message: 'LAST_NAME_REQUIRED' }).trim().min(1, 'LAST_NAME_REQUIRED').max(100, 'LAST_NAME_REQUIRED'),
    phone: z.string({ message: 'PHONE_INVALID' }).trim().regex(PHONE_PATTERN, 'PHONE_INVALID'),
  })
  .strict()

export type ProfilePatchInput = z.infer<typeof profilePatchSchema>

export function parseProfilePatch(
  raw: unknown,
): { ok: true; value: ProfilePatchInput & { phone: string } } | { ok: false; codes: string[] } {
  const result = profilePatchSchema.safeParse(raw ?? {})
  if (!result.success) {
    return { ok: false, codes: [...new Set(result.error.issues.map((issue) => issue.message))] }
  }
  // The same normalisation registration applies — stored without dashes.
  return { ok: true, value: { ...result.data, phone: normalisePhone(result.data.phone) } }
}
