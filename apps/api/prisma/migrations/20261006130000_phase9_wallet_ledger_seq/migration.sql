-- Phase 9 review fix: a per-wallet ledger sequence taken under the wallet row lock, so ordering by `seq`
-- always agrees with `balance_after` (created_at is only a timestamp, not an order).

ALTER TABLE "wallets" ADD COLUMN "last_seq" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "wallet_transactions" ADD COLUMN "seq" BIGINT;

-- Backfill existing rows in their recorded order (the append-only trigger is paused for this one update).
ALTER TABLE "wallet_transactions" DISABLE TRIGGER wallet_transactions_no_update_delete;
UPDATE "wallet_transactions" t SET "seq" = o.rn
FROM (SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at, id) AS rn FROM "wallet_transactions") o
WHERE o.id = t.id;
ALTER TABLE "wallet_transactions" ENABLE TRIGGER wallet_transactions_no_update_delete;
UPDATE "wallets" w SET "last_seq" = coalesce((SELECT max("seq") FROM "wallet_transactions" t WHERE t.user_id = w.user_id), 0);

ALTER TABLE "wallet_transactions" ALTER COLUMN "seq" SET NOT NULL;
CREATE UNIQUE INDEX "wallet_transactions_user_id_seq_key" ON "wallet_transactions"("user_id", "seq");
