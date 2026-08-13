-- ISSUE-079 — every timestamp column becomes `timestamptz`.
--
-- Approved by the user 2026-08-13. Recorded as DEC-062.
--
-- 🔴 WHY NOW, AND NOT LATER. The columns were `timestamp WITHOUT time zone`
-- defaulted from CURRENT_TIMESTAMP, with the database's TimeZone set to
-- Asia/Jerusalem — so a stored value was local wall-clock time with no record
-- of which zone produced it. Move the database, or run a second one in another
-- zone, and identical rows mean different instants. Israel observes DST, so the
-- hour repeated each autumn is genuinely ambiguous in stored data.
--
-- 🔴 NO DATA MIGRATION IS NEEDED, AND THAT IS THE ENTIRE REASON FOR THE TIMING.
-- Measured immediately before generating this file:
--     orders 0 · order_items 0 · order_status_history 0 · users 0 · carts 0
-- Only seeded rows carry timestamps (49 products plus catalogue reference
-- data), and those are reproducible from the seed. Every additional real order
-- would have made this conversion more expensive.
--
-- ⚠️ `SET DATA TYPE TIMESTAMPTZ` with no `USING` clause interprets each existing
-- value in the session's TimeZone — Asia/Jerusalem here, which is exactly the
-- zone CURRENT_TIMESTAMP wrote them in. The conversion is therefore correct for
-- the rows that do exist, rather than merely harmless because they are few.
--
-- 🔴 `session.expire` IS DELIBERATELY NOT TOUCHED. That table belongs to
-- `connect-pg-simple`, was created by the library and BASELINED rather than
-- migrated (DEC-052 Part 2, `migrate resolve --applied`). Its own SQL and its
-- pruning query expect the shape it has; changing it here would be Prisma
-- editing a table Prisma does not own.

-- AlterTable
ALTER TABLE "addresses" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "carts" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "email_verification_tokens" ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "used_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "favorites" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "funnel_events" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "order_status_history" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "password_reset_tokens" ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "used_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "terms_accepted_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "locked_until" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ;

