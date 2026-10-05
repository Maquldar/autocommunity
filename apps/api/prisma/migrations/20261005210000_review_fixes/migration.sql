-- Location plausibility: positions implying > 300 km/h are stored but untrusted for a while.
ALTER TABLE "user_locations" ADD COLUMN "untrusted_until" TIMESTAMP(3);

-- Community names: a normalized key (the API computes it; this backfill approximates it in SQL).
ALTER TABLE "communities" ADD COLUMN "name_key" TEXT;
UPDATE "communities"
SET "name_key" = lower(regexp_replace(btrim(regexp_replace(normalize("name", NFKC), '\s+', ' ', 'g')), '[[:punct:]…]+$', ''));
ALTER TABLE "communities" ALTER COLUMN "name_key" SET NOT NULL;
DROP INDEX IF EXISTS "communities_name_lower_active_key";
CREATE UNIQUE INDEX "communities_name_key_active_key" ON "communities" ("name_key") WHERE "deleted_at" IS NULL;

-- An upload can be attached once: one message, one user avatar, one community avatar.
CREATE UNIQUE INDEX "messages_upload_id_key" ON "messages" ("upload_id") WHERE "upload_id" IS NOT NULL;
CREATE UNIQUE INDEX "users_avatar_upload_id_key" ON "users" ("avatar_upload_id") WHERE "avatar_upload_id" IS NOT NULL;
CREATE UNIQUE INDEX "communities_avatar_upload_id_key" ON "communities" ("avatar_upload_id") WHERE "avatar_upload_id" IS NOT NULL;
-- SOS photos (an array) are checked under a row lock on the uploads; this index serves that check.
CREATE INDEX "sos_requests_photo_upload_ids_idx" ON "sos_requests" USING GIN ("photo_upload_ids");

-- Dispatch idempotency: rows are notified once; a retried job picks up rows still unnotified.
ALTER TABLE "sos_dispatches" ADD COLUMN "notified_at" TIMESTAMP(3);
UPDATE "sos_dispatches" SET "notified_at" = "created_at";
CREATE INDEX "sos_dispatches_unnotified_idx" ON "sos_dispatches" ("sos_id") WHERE "notified_at" IS NULL;
