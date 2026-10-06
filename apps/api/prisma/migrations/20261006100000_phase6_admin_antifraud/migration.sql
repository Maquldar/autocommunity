-- Phase 6: admin panel and antifraud v1.

-- otp_abuse flags can concern a phone number without an account (details.phoneMasked).
ALTER TABLE "fraud_flags" ALTER COLUMN "user_id" DROP NOT NULL;
CREATE INDEX "fraud_flags_kind_created_at_idx" ON "fraud_flags"("kind", "created_at");

-- Audit log filtered by admin; admin users list ordered by sign-up time.
CREATE INDEX "admin_actions_admin_id_created_at_idx" ON "admin_actions"("admin_id", "created_at");
CREATE INDEX "users_created_at_idx" ON "users"("created_at");
