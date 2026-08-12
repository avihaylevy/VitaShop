-- DEC-032 DECISION B (Accepted 2026-08-12).
-- Additive only: one new column on "products", NOT NULL with a default so no
-- backfill is required and no existing column is touched.
--
-- Semantics are PROVENANCE, not absence: true means the manufacturer's official
-- page was checked and "warnings_allergens" already holds everything it
-- publishes -- which may be a partial declaration, or nothing at all. The flag
-- COMPOSES with "warnings_allergens" rather than replacing it.

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "allergen_info_incomplete" BOOLEAN NOT NULL DEFAULT false;
