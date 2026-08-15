-- DEC-086 / MILESTONE-012 (user-approved 2026-08-15): the membership club.
-- Flat single-tier: a boolean plus the join timestamp. Discounting itself
-- lives in application code (lib/clubPricing.ts) — no rate is stored here,
-- so changing the rate is a code change, not a data migration.
ALTER TABLE "users" ADD COLUMN "is_club_member" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "club_joined_at" TIMESTAMPTZ;
