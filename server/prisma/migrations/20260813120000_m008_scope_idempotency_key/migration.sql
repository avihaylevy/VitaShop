-- MILESTONE-008 — a REVIEW-RESPONSE migration, following 20260813000000.
--
-- Three corrections raised by `/code-review high server/prisma` against
-- e4c63e9. All three were cheap now (0 orders) and a migration against
-- populated orders later.
--
-- 1. 🔴 THE IDEMPOTENCY KEY IS SCOPED TO THE USER.
--    A GLOBAL unique made the natural retry lookup
--    `findUnique({ where: { idempotency_key } })` — no user filter, because the
--    constraint never asked for one. A key belonging to ANOTHER SHOPPER would
--    match, and the retry would hand back THEIR ORDER. The key is
--    client-supplied, so its value is attacker-controlled. Global uniqueness
--    also let one account claim a key and block it for every other account,
--    permanently.
--    The composite gives identical replay protection and makes the scoping
--    STRUCTURAL rather than something Checkpoint C has to remember.
--
-- 2. order_items gains ONE PRODUCT, ONE LINE — DEC-055's cart-side rule on the
--    order side. Without it a partial retry or a loop bug writes two lines for
--    one product, and then total_amount and the sum of the items disagree with
--    no way to tell which is right.
--
-- 3. order_status_history.changed_by_user_id gains an index. Postgres does not
--    index a foreign-key column automatically; without it every ON DELETE
--    RESTRICT check is a sequential scan, and MILESTONE-010's "what did admin X
--    do?" audit query is a full scan. Every other relation in the schema
--    carries an explicit index.
--
-- ✅ THIS MIGRATION IS REPLAY-SAFE, and deliberately so — the previous one was
-- not. It only creates and drops INDEXES: no column is dropped, no NOT NULL
-- column is added without a default, nothing needs a backfill. It is correct
-- against an empty table and a populated one alike.
-- ⚠️ The two UNIQUE indexes would fail on a table that already holds
-- duplicates, which is the constraint doing its job rather than a defect.

-- DropIndex
DROP INDEX "orders_idempotency_key_key";

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_product_id_key" ON "order_items"("order_id", "product_id");

-- CreateIndex
CREATE INDEX "order_status_history_changed_by_user_id_idx" ON "order_status_history"("changed_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_user_id_idempotency_key_key" ON "orders"("user_id", "idempotency_key");
