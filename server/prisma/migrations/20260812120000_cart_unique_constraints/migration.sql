-- DEC-055 (Accepted 2026-08-12, with the two-constraint P2002 amendment).
--
-- Closes a check-then-create race in the cart. Measured before this migration:
-- 5 concurrent adds for ONE session produced 3 carts, and getCart's findFirst
-- saw one, so every row in the losing carts was invisible and unrecoverable.
-- Nothing threw.
--
-- PRECHECKED against the dev database on 2026-08-12 before running:
--   carts 0 · cart_items 0 · duplicate sessions 0 · duplicate users 0
--   duplicate (cart_id, product_id) pairs 0
-- so NO cleanup was required and NO row was removed by this migration. Had
-- duplicates existed, the merge/delete rule would have been decided and stated
-- HERE rather than letting rows vanish as a side effect of a schema change.
--
-- The two DROP INDEX statements are not a loss of coverage: each is replaced
-- by a UNIQUE index on the same column, which serves the same lookups.
--
-- NOT a partial index: both cart identity columns are nullable and exactly one
-- is set. PostgreSQL treats NULLs as DISTINCT in a unique index, so each
-- constraint allows unlimited NULLs while permitting one row per real identity.

-- DropIndex
DROP INDEX "carts_session_id_idx";

-- DropIndex
DROP INDEX "carts_user_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_product_id_key" ON "cart_items"("cart_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "carts_user_id_key" ON "carts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "carts_session_id_key" ON "carts"("session_id");
