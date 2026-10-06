-- Phase 9: vehicle details, coin wallet, premium, driver votes, vehicle violations (API.md §9).

-- CreateEnum
CREATE TYPE "VehicleFuel" AS ENUM ('petrol', 'diesel', 'gas', 'hybrid', 'electric');

-- CreateEnum
CREATE TYPE "VehicleTransmission" AS ENUM ('manual', 'automatic', 'robot', 'cvt');

-- CreateEnum
CREATE TYPE "VehicleDrive" AS ENUM ('fwd', 'rwd', 'awd');

-- CreateEnum
CREATE TYPE "VehicleBodyType" AS ENUM ('sedan', 'hatchback', 'wagon', 'suv', 'crossover', 'coupe', 'minivan', 'pickup', 'van');

-- CreateEnum
CREATE TYPE "VehicleColor" AS ENUM ('white', 'black', 'silver', 'gray', 'red', 'blue', 'green', 'brown', 'beige', 'yellow', 'orange', 'other');

-- CreateEnum
CREATE TYPE "WalletTxKind" AS ENUM ('topup', 'transfer_out', 'transfer_in', 'subscription', 'admin_adjust', 'refund');

-- CreateEnum
CREATE TYPE "TopupStatus" AS ENUM ('pending', 'succeeded', 'declined', 'expired');

-- CreateEnum
CREATE TYPE "ViolationCategory" AS ENUM ('speeding', 'red_light', 'drunk_driving', 'wrong_lane', 'no_license', 'accident_fled', 'dangerous_driving', 'parking', 'other');

-- CreateEnum
CREATE TYPE "ViolationCodeType" AS ENUM ('koap', 'uk');

-- CreateEnum
CREATE TYPE "ViolationStatus" AS ENUM ('pending', 'approved', 'rejected', 'disputed', 'removed');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "premium_until" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "body_type" "VehicleBodyType",
ADD COLUMN     "color" "VehicleColor",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "drive" "VehicleDrive",
ADD COLUMN     "engine_volume_l" DOUBLE PRECISION,
ADD COLUMN     "fuel" "VehicleFuel",
ADD COLUMN     "mileage_km" INTEGER,
ADD COLUMN     "photo_upload_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "transmission" "VehicleTransmission",
ADD COLUMN     "vin" TEXT;

-- CreateTable
CREATE TABLE "wallets" (
    "user_id" UUID NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "frozen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "WalletTxKind" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balance_after" BIGINT NOT NULL,
    "counterparty_user_id" UUID,
    "ref" UUID,
    "note" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topups" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "status" "TopupStatus" NOT NULL DEFAULT 'pending',
    "card_last4" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "premium_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "auto_renew" BOOLEAN NOT NULL DEFAULT true,
    "reminder_sent_for" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "end_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "premium_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_votes" (
    "id" UUID NOT NULL,
    "voter_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "value" SMALLINT NOT NULL,
    "reason" TEXT NOT NULL,
    "comment" TEXT,
    "weight" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "violations" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID,
    "owner_id" UUID NOT NULL,
    "submitter_id" UUID NOT NULL,
    "vehicle_brand" TEXT NOT NULL,
    "vehicle_model" TEXT NOT NULL,
    "vehicle_year" INTEGER NOT NULL,
    "category" "ViolationCategory" NOT NULL,
    "code_type" "ViolationCodeType" NOT NULL,
    "article" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "photo_upload_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "ViolationStatus" NOT NULL DEFAULT 'pending',
    "dispute_text" TEXT,
    "disputed_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "decided_by_id" UUID,
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "violations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wallet_transactions_user_id_created_at_id_idx" ON "wallet_transactions"("user_id", "created_at" DESC, "id");

-- CreateIndex
CREATE INDEX "wallet_transactions_counterparty_user_id_kind_created_at_idx" ON "wallet_transactions"("counterparty_user_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "wallet_transactions_user_id_kind_created_at_idx" ON "wallet_transactions"("user_id", "kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_user_id_idempotency_key_key" ON "wallet_transactions"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "topups_user_id_created_at_idx" ON "topups"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "premium_subscriptions_user_id_idx" ON "premium_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "premium_subscriptions_current_period_end_idx" ON "premium_subscriptions"("current_period_end");

-- CreateIndex
CREATE INDEX "user_votes_target_id_created_at_idx" ON "user_votes"("target_id", "created_at");

-- CreateIndex
CREATE INDEX "user_votes_voter_id_target_id_created_at_idx" ON "user_votes"("voter_id", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "user_votes_voter_id_created_at_idx" ON "user_votes"("voter_id", "created_at");

-- CreateIndex
CREATE INDEX "violations_vehicle_id_status_idx" ON "violations"("vehicle_id", "status");

-- CreateIndex
CREATE INDEX "violations_owner_id_status_idx" ON "violations"("owner_id", "status");

-- CreateIndex
CREATE INDEX "violations_submitter_id_created_at_idx" ON "violations"("submitter_id", "created_at");

-- CreateIndex
CREATE INDEX "violations_status_created_at_idx" ON "violations"("status", "created_at");

-- CreateIndex
CREATE INDEX "violations_photo_upload_ids_idx" ON "violations" USING GIN ("photo_upload_ids");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topups" ADD CONSTRAINT "topups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "premium_subscriptions" ADD CONSTRAINT "premium_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_votes" ADD CONSTRAINT "user_votes_voter_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_votes" ADD CONSTRAINT "user_votes_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violations" ADD CONSTRAINT "violations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violations" ADD CONSTRAINT "violations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violations" ADD CONSTRAINT "violations_submitter_id_fkey" FOREIGN KEY ("submitter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Balances never go negative; ledger rows always carry a non-zero amount.
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_non_negative" CHECK ("balance" >= 0);
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_amount_non_zero" CHECK ("amount" <> 0);
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_balance_after_non_negative" CHECK ("balance_after" >= 0);

-- The ledger is immutable: rows are only ever inserted.
CREATE FUNCTION wallet_transactions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'wallet_transactions is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER wallet_transactions_no_update_delete
  BEFORE UPDATE OR DELETE ON "wallet_transactions"
  FOR EACH ROW EXECUTE FUNCTION wallet_transactions_immutable();

-- At most one live premium subscription per user.
CREATE UNIQUE INDEX "premium_subscriptions_one_live_per_user" ON "premium_subscriptions"("user_id") WHERE "ended_at" IS NULL;

ALTER TABLE "user_votes" ADD CONSTRAINT "user_votes_value_check" CHECK ("value" IN (-1, 1));
ALTER TABLE "topups" ADD CONSTRAINT "topups_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_engine_volume_range" CHECK ("engine_volume_l" IS NULL OR ("engine_volume_l" >= 0.6 AND "engine_volume_l" <= 8.0));
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_mileage_non_negative" CHECK ("mileage_km" IS NULL OR "mileage_km" >= 0);

-- Uploads attached to vehicles (orphan purge looks them up).
CREATE INDEX "vehicles_photo_upload_ids_idx" ON "vehicles" USING GIN ("photo_upload_ids");
