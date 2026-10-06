-- Phase 10: payments at partner points (API.md §10).

-- CreateEnum
CREATE TYPE "PayUnit" AS ENUM ('l', 'pcs', 'service');

-- CreateEnum
CREATE TYPE "PayMethod" AS ENUM ('coins', 'google_pay');

-- AlterEnum
ALTER TYPE "ServiceCategory" ADD VALUE 'fuel';

-- AlterEnum
ALTER TYPE "WalletTxKind" ADD VALUE 'purchase';
ALTER TYPE "WalletTxKind" ADD VALUE 'sale';

-- AlterTable
ALTER TABLE "service_centers" ADD COLUMN     "accepts_payments" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "owner_id" UUID,
ADD COLUMN     "pay_tag" TEXT;

-- CreateTable
CREATE TABLE "pay_items" (
    "id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_coins" INTEGER NOT NULL,
    "unit" "PayUnit" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pay_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "method" "PayMethod" NOT NULL,
    "total" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "wallet_tx_id" UUID,
    "topup_id" UUID,
    "payee_user_id" UUID,
    "card_network" TEXT,
    "card_last4" TEXT,
    "balance_after" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_settlements" (
    "id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pay_items_service_id_sort_order_idx" ON "pay_items"("service_id", "sort_order");

-- CreateIndex
CREATE INDEX "pay_orders_user_id_created_at_id_idx" ON "pay_orders"("user_id", "created_at" DESC, "id");

-- CreateIndex
CREATE INDEX "pay_orders_service_id_created_at_idx" ON "pay_orders"("service_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "pay_orders_user_id_idempotency_key_key" ON "pay_orders"("user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_settlements_order_id_key" ON "merchant_settlements"("order_id");

-- CreateIndex
CREATE INDEX "merchant_settlements_service_id_created_at_idx" ON "merchant_settlements"("service_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "service_centers_pay_tag_key" ON "service_centers"("pay_tag");

-- AddForeignKey
ALTER TABLE "service_centers" ADD CONSTRAINT "service_centers_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_items" ADD CONSTRAINT "pay_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service_centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_orders" ADD CONSTRAINT "pay_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_orders" ADD CONSTRAINT "pay_orders_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service_centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Guards (like the Phase 9 wallet ones).
ALTER TABLE "pay_items" ADD CONSTRAINT "pay_items_price_positive" CHECK ("price_coins" > 0);
ALTER TABLE "pay_orders" ADD CONSTRAINT "pay_orders_total_positive" CHECK ("total" > 0);
ALTER TABLE "merchant_settlements" ADD CONSTRAINT "merchant_settlements_amount_positive" CHECK ("amount" > 0);
