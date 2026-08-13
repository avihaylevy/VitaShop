-- MILESTONE-008 Checkpoint B — the order freeze. DEC-059, ISSUE-028, ISSUE-077.
--
-- Six schema gaps in ONE migration, all the same shape: an order must FREEZE
-- what was agreed, not point at a row that can change afterwards. Six separate
-- migrations against a seeded database would be six chances to get it wrong.
--
-- Generated with `migrate diff --script` and REVIEWED before running — the
-- established method here, because `vitashop_app` lacks CREATEDB and the
-- shadow-database `migrate dev` flow is unavailable (DEC-033, DEC-052 2a-note).
--
-- 🔴 ONE DESTRUCTIVE STATEMENT, AND IT IS DELIBERATE. Line 5 DROPs
-- `product_name_at_purchase`. It is a RENAME expressed as drop-plus-add: the
-- single column could not say WHICH LANGUAGE it held, in a store that sells in
-- two. Row counts were checked twice — at the start of the pass and again
-- immediately before applying — and `order_items` held 0 rows both times, so
-- nothing was destroyed. 🔴 Re-check before replaying this anywhere that has
-- data; on a populated table it would need a copy-then-drop instead.
--
-- The NOT NULL columns on `orders` carry no DEFAULT for the same reason: 0
-- orders existed. On a populated table each would need a backfill first.

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('self_pickup', 'courier', 'pickup_point');

-- AlterTable
ALTER TABLE "order_items" DROP COLUMN "product_name_at_purchase",
ADD COLUMN     "product_name_en_at_purchase" TEXT NOT NULL,
ADD COLUMN     "product_name_he_at_purchase" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "order_status_history" ADD COLUMN     "changed_by_user_id" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivery_method" "DeliveryMethod" NOT NULL,
ADD COLUMN     "idempotency_key" TEXT NOT NULL,
ADD COLUMN     "shipping_city" TEXT,
ADD COLUMN     "shipping_cost" DECIMAL(10,2) NOT NULL,
ADD COLUMN     "shipping_line1" TEXT,
ADD COLUMN     "shipping_zip_code" TEXT,
ADD COLUMN     "tracking_number" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

