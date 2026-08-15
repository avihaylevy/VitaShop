-- ISSUE-127a (user-approved 2026-08-15): the brand's manufacturer-verified
-- Latin form. Nullable — a brand without a sourced Latin form has none yet.
-- Values are written by the seed from its BRAND_EN map (DEC-032-sourced).
ALTER TABLE "brands" ADD COLUMN "name_en" TEXT;
