-- DEC-083 (user-approved 2026-08-15): three dietary flags for DEC-078's
-- kosher / gluten-free / vegan filters. Nullable, and NULL means UNKNOWN —
-- never false: values are sourced-only from manufacturer pages (DEC-032's
-- no-invention rule), written by the seed from the products CSV. The
-- catalogue filters match TRUE only.
ALTER TABLE "products" ADD COLUMN "is_kosher" BOOLEAN;
ALTER TABLE "products" ADD COLUMN "is_gluten_free" BOOLEAN;
ALTER TABLE "products" ADD COLUMN "is_vegan" BOOLEAN;
