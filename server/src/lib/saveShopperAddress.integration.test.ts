import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { saveShopperAddress } from './saveShopperAddress.js'

/**
 * ISSUE-093 — the `Address` writer, opt-in and after the commit.
 */

let prisma: PrismaClient
let userId = ''
const EMAIL = 'zz-saveaddr@example.test'
const ADDRESS = { line1: 'רחוב הבדיקה 4', city: 'תל אביב', zipCode: '6100000' }

beforeAll(async () => {
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    create: {
      email: EMAIL,
      firstName: 'Save',
      lastName: 'Address',
      passwordHash: 'x',
      termsAcceptedAt: new Date(),
      status: 'active',
      role: 'customer',
    },
    update: {},
    select: { id: true },
  })
  userId = user.id
}, 60_000)

afterEach(async () => {
  await prisma.address.deleteMany({ where: { userId } })
})

afterAll(async () => {
  await prisma.address.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: EMAIL } })
  await prisma.$disconnect()
})

async function rows() {
  return prisma.address.findMany({
    where: { userId },
    select: { line1: true, city: true, zipCode: true, isDefault: true },
    orderBy: { createdAt: 'asc' },
  })
}

describe('what gets written', () => {
  it('saves the address, and the FIRST one is the default', async () => {
    expect(await saveShopperAddress(prisma, { userId, address: ADDRESS })).toBe('saved')
    expect(await rows()).toEqual([
      { line1: 'רחוב הבדיקה 4', city: 'תל אביב', zipCode: '6100000', isDefault: true },
    ])
  })

  it('a SECOND, different address is saved but is NOT the default', async () => {
    // Choosing between several is REQ-F-051's "manage addresses" — M-009's.
    // Silently re-pointing the default would change where a shopper's next
    // order goes without them asking.
    await saveShopperAddress(prisma, { userId, address: ADDRESS })
    expect(
      await saveShopperAddress(prisma, {
        userId,
        address: { line1: 'רחוב אחר 9', city: 'חיפה', zipCode: null },
      }),
    ).toBe('saved')

    const saved = await rows()
    expect(saved).toHaveLength(2)
    expect(saved[0]!.isDefault).toBe(true)
    expect(saved[1]!.isDefault).toBe(false)
  })

  it('🔴 the SAME address twice does not collect two rows', async () => {
    await saveShopperAddress(prisma, { userId, address: ADDRESS })
    expect(await saveShopperAddress(prisma, { userId, address: ADDRESS })).toBe('skipped-duplicate')
    expect(await rows()).toHaveLength(1)
  })

  it('ignores trailing whitespace rather than calling it a new address', async () => {
    await saveShopperAddress(prisma, { userId, address: ADDRESS })
    expect(
      await saveShopperAddress(prisma, {
        userId,
        address: { line1: '  רחוב הבדיקה 4  ', city: ' תל אביב ', zipCode: ' 6100000 ' },
      }),
    ).toBe('skipped-duplicate')
    expect(await rows()).toHaveLength(1)
  })

  it('treats a missing zip and an explicit null as the same address', async () => {
    await saveShopperAddress(prisma, {
      userId,
      address: { line1: 'רחוב ללא מיקוד 2', city: 'רמת גן', zipCode: null },
    })
    expect(
      await saveShopperAddress(prisma, { userId, address: { line1: 'רחוב ללא מיקוד 2', city: 'רמת גן' } }),
    ).toBe('skipped-duplicate')
    expect(await rows()).toHaveLength(1)
  })
})

describe('what does NOT get written', () => {
  it('self pickup carries no address, so nothing is saved', async () => {
    expect(await saveShopperAddress(prisma, { userId, address: null })).toBe('skipped-empty')
    expect(await rows()).toHaveLength(0)
  })

  it.each([
    { line1: '', city: 'תל אביב', zipCode: null },
    { line1: 'רחוב 1', city: '   ', zipCode: null },
  ])('a blank field is not an address (%j)', async (address) => {
    expect(await saveShopperAddress(prisma, { userId, address })).toBe('skipped-empty')
    expect(await rows()).toHaveLength(0)
  })

  /**
   * 🔴 THE PROPERTY THAT MATTERS MOST: it can never take the request down with
   * it. The order is committed by the time this runs, and a convenience write
   * that throws would tell a shopper their order failed — the §8.12 defect,
   * one step later.
   */
  it('returns `failed` instead of throwing when the write is impossible', async () => {
    const result = await saveShopperAddress(prisma, {
      // A user id that cannot exist: the foreign key must reject it.
      userId: '00000000-0000-0000-0000-000000000000',
      address: ADDRESS,
    })
    expect(result).toBe('failed')
  })
})

describe('DEC-090 O5 — the cap binds here too (M-009 review)', () => {
  it('🔴 skipped-cap at five rows, and NOTHING is written', async () => {
    for (let i = 0; i < 5; i++) {
      await prisma.address.create({
        data: { userId, line1: `רחוב ${i}`, city: 'תל אביב', isDefault: i === 0 },
      })
    }
    const result = await saveShopperAddress(prisma, {
      userId,
      address: { line1: 'רחוב שישי', city: 'חיפה' },
    })
    expect(result).toBe('skipped-cap')
    expect(await rows()).toHaveLength(5)
  })

  it('a DUPLICATE at a full book answers skipped-duplicate, not skipped-cap — the dedup check runs first', async () => {
    // Pinned deliberately: "you already have this address" is the truer
    // answer than "your book is full" when both hold.
    for (let i = 0; i < 5; i++) {
      await prisma.address.create({
        data: { userId, line1: `רחוב ${i}`, city: 'תל אביב', isDefault: i === 0 },
      })
    }
    const result = await saveShopperAddress(prisma, {
      userId,
      address: { line1: 'רחוב 2', city: 'תל אביב' },
    })
    expect(result).toBe('skipped-duplicate')
  })

  it('over-long values are skipped-invalid — the book PATCH must never refuse a row this writer created', async () => {
    const result = await saveShopperAddress(prisma, {
      userId,
      address: { line1: 'א'.repeat(201), city: 'תל אביב' },
    })
    expect(result).toBe('skipped-invalid')
    expect(await rows()).toHaveLength(0)
  })
})
