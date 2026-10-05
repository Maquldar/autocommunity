-- Demo seed marker: DEMO_LIVE_LOCATIONS only ever moves these users.
ALTER TABLE "users" ADD COLUMN "is_seed" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "users_is_seed_idx" ON "users" ("id") WHERE "is_seed";

-- Server-managed settings (auto-generated VAPID key pair).
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);
