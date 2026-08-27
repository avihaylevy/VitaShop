-- Pass 131 (DEC-111): the card's short-description teaser, paired (DEC-017).
-- Default '' so existing rows migrate clean; content arrives via seed/admin.
ALTER TABLE "products" ADD COLUMN "short_description_he" TEXT NOT NULL DEFAULT '';
ALTER TABLE "products" ADD COLUMN "short_description_en" TEXT NOT NULL DEFAULT '';
