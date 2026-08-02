import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

// DATABASE_URL is required at runtime but not yet configured (PostgreSQL not
// installed on this machine) — this module is not imported by anything yet.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })

export const prisma = new PrismaClient({ adapter })
