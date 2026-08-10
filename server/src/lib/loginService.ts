import argon2 from 'argon2'
import type { PrismaClient, UserStatus } from '@prisma/client'
import { ARGON2_OPTIONS } from './registrationService.js'

/**
 * MILESTONE-006 Checkpoint E — login and lockout.
 *
 * Implements clauses A1, A2 and A5, all FROZEN. Every one of them fails
 * quietly if weakened: A1 and A2 leak account existence, A5 turns a
 * five-attempt lockout into a one-attempt one.
 */

/** REQ-F-033 — five failures, fifteen minutes. */
export const MAX_FAILED_ATTEMPTS = 5
export const LOCKOUT_MS = 15 * 60 * 1000

/**
 * 🔴 CLAUSE A1 — ONE message for every failure.
 *
 * Unknown email, wrong password and locked account all return exactly this,
 * with the same status and the same body shape. No per-case branch, no extra
 * field, no different code.
 *
 * The tempting change is a "helpful" variant — "no account with that email",
 * or "your account is locked, try again in 12 minutes". Each one turns login
 * into an account-enumeration oracle. The lockout variant is worse than it
 * looks: it confirms the address exists AND that someone is attacking it.
 */
export const LOGIN_FAILURE_CODE = 'LOGIN_FAILED'
export const LOGIN_FAILURE_MESSAGE = 'Email or password is incorrect.'

/**
 * 🔴 CLAUSE A2 — the fixed, application-constant hash the unknown-email path
 * verifies against.
 *
 * Without it the unknown-email branch skips verification entirely and returns
 * measurably faster than the others, which is the same oracle A1 closes,
 * reached through timing instead of the response body.
 *
 * Computed once and cached, so every request after the first pays the same
 * cost. `prewarmDummyHash()` exists so the very first unknown-email login is
 * not the odd one out; the app calls it at startup.
 */
let dummyHashPromise: Promise<string> | undefined

export function prewarmDummyHash(): Promise<string> {
  dummyHashPromise ??= argon2.hash(
    'a-fixed-application-constant-value-never-a-real-password',
    ARGON2_OPTIONS,
  )
  return dummyHashPromise
}

export interface LoginInput {
  email: string
  password: string
}

export type LoginOutcome =
  | { ok: true; userId: string }
  // 🔴 Carries NO reason. The caller cannot accidentally leak which branch
  // failed, because the information does not leave this function.
  | { ok: false }

export interface LoginDeps {
  prisma: PrismaClient
  now?: () => Date
}

interface UserRow {
  id: string
  passwordHash: string
  status: UserStatus
  failedLoginCount: number
  lockedUntil: Date | null
}

/**
 * 🔴 CLAUSE A5 — the single source of truth for "locked", per DEC-024.
 * There is no `locked` status value; the timestamp IS the state.
 */
export function isLocked(user: { lockedUntil: Date | null }, now: Date): boolean {
  return user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime()
}

export async function attemptLogin(
  input: LoginInput,
  deps: LoginDeps,
): Promise<LoginOutcome> {
  const now = deps.now?.() ?? new Date()

  const user = (await deps.prisma.user.findUnique({
    where: { email: input.email.trim().toLowerCase() },
    select: {
      id: true,
      passwordHash: true,
      status: true,
      failedLoginCount: true,
      lockedUntil: true,
    },
  })) as UserRow | null

  // ── A5: the lazy reset, BEFORE anything is evaluated ──────────────────────
  // 🔴 If the lockout has expired, zero the counter AND clear the timestamp.
  // Without this the counter sits at 5 the moment the window passes, so the
  // next single failure re-locks immediately — a permanent one-strike lockout,
  // which is not what REQ-F-033's "5 failed attempts" means.
  //
  // 🔴 It is a WRITE on one branch only, and it must NOT become an early
  // return: A2 requires every path to reach the hash verification below.
  let failedLoginCount = user?.failedLoginCount ?? 0
  let lockedUntil = user?.lockedUntil ?? null
  if (user && lockedUntil !== null && lockedUntil.getTime() <= now.getTime()) {
    await deps.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    })
    failedLoginCount = 0
    lockedUntil = null
  }

  // ── A2: EXACTLY ONE hash verification, on EVERY branch ───────────────────
  // Unknown email verifies against the constant dummy so it costs the same as
  // a real one. The locked branch runs it too — see below.
  const hashToVerify = user?.passwordHash ?? (await prewarmDummyHash())
  const passwordMatches = await argon2.verify(hashToVerify, input.password).catch(() => false)

  // ── Branch 1: unknown email. A1's message, after the verify above. ───────
  if (!user) return { ok: false }

  // ── Branch 2: locked. ─────────────────────────────────────────────────────
  // 🔴 This check sits AFTER the verification, deliberately. Returning here
  // before hashing would make a locked account measurably faster than a wrong
  // password — leaking both that the address exists and that it is locked.
  if (isLocked({ lockedUntil }, now)) return { ok: false }

  // ── Branch 3: wrong password. ────────────────────────────────────────────
  if (!passwordMatches) {
    const nextCount = failedLoginCount + 1
    await deps.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: nextCount,
        // REQ-F-033 — the FIFTH failure locks.
        lockedUntil: nextCount >= MAX_FAILED_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_MS) : null,
      },
    })
    return { ok: false }
  }

  // ── Success. Reset the counters. ─────────────────────────────────────────
  // A disabled account is still refused — with A1's identical message, since
  // "your account is disabled" is the same class of disclosure.
  if (user.status === 'disabled') return { ok: false }

  await deps.prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null },
  })

  return { ok: true, userId: user.id }
}
