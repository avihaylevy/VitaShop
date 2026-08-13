import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import { assertLocalDevTarget } from './assertLocalDevTarget.js'
import { ARGON2_OPTIONS } from '../src/lib/registrationService.js'

/**
 * ISSUE-083 — two accounts to test the project by hand.
 *
 * ```
 * npm run seed:accounts
 * ```
 *
 * 🔴 THE USER ASKED FOR THIS DIRECTLY (2026-08-13): *"there should be an admin
 * user built in so i can see relevant screens and test it myself"*. Before it,
 * the database held **zero** users — every account belonged to an integration
 * suite that deletes its own on teardown, so there was nothing to sign in as.
 *
 * ⚠️ SEPARATE FROM `seed.ts`, DELIBERATELY. The catalogue seed is idempotent
 * over product data and SOFT-DELETES anything no longer verified; accounts have
 * nothing to do with that, and mixing them would mean re-running one to get the
 * other. This script can be run on its own, repeatedly.
 *
 * 🔴 IT REFUSES ANY DATABASE BUT THE LOCAL DEV ONE — the same guard `seed.ts`
 * uses, imported rather than copied.
 *
 * ── CREDENTIALS ────────────────────────────────────────────────────────────
 *
 * 🔴 NOTHING IS HARDCODED AND NOTHING IS COMMITTED. Both passwords come from
 * the environment, and the script REFUSES to run without them rather than
 * inventing a default — a default password in a seed script is a real
 * credential the moment anyone points it at something that is not a laptop.
 * `.env.example` documents the variables; `.env` holds the values and is
 * git-ignored.
 *
 * ⚠️ Passwords are hashed with the SAME `ARGON2_OPTIONS` registration uses, so
 * these accounts log in through the ordinary path with no special case.
 */

assertLocalDevTarget()

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

function required(name: string): string {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(
      `${name} is not set. Refusing to seed an account with a default password — ` +
        'see .env.example and set your own value in .env.',
    )
  }
  return value
}

async function upsertAccount(input: {
  email: string
  password: string
  firstName: string
  lastName: string
  role: 'customer' | 'admin'
}): Promise<void> {
  const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS)
  await prisma.user.upsert({
    where: { email: input.email },
    create: {
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      passwordHash,
      termsAcceptedAt: new Date(),
      // 🔴 `active`, not `pending_verification`. Clause A9 blocks an unverified
      // account from completing an order, and the point of these two accounts
      // is to place one. Verifying by email would mean reading the console for
      // a link every time the database is reset.
      status: 'active',
      role: input.role,
    },
    update: {
      // ⚠️ RE-RUNNABLE. The password is re-hashed from the environment on every
      // run, so changing it in `.env` and re-running is the supported way to
      // reset it — and an account that drifted to `pending_verification` or lost
      // its role is put back.
      passwordHash,
      status: 'active',
      role: input.role,
    },
    select: { id: true },
  })
  console.log(`  ✅ ${input.role.padEnd(8)} ${input.email}`)
}

async function main(): Promise<void> {
  console.log('Seeding development accounts (ISSUE-083)…')

  await upsertAccount({
    email: required('SEED_ADMIN_EMAIL'),
    password: required('SEED_ADMIN_PASSWORD'),
    firstName: 'Admin',
    lastName: 'VitaShop',
    role: 'admin',
  })

  await upsertAccount({
    email: required('SEED_SHOPPER_EMAIL'),
    password: required('SEED_SHOPPER_PASSWORD'),
    firstName: 'Test',
    lastName: 'Shopper',
    role: 'customer',
  })

  console.log('Done. Both accounts are `active` and can sign in immediately.')
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
