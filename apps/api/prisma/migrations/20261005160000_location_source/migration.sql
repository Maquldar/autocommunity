-- Who wrote a position: DEMO_LIVE_LOCATIONS only moves rows written by the seed, never a client's position.
CREATE TYPE "LocationSource" AS ENUM ('seed', 'client');
ALTER TABLE "user_locations" ADD COLUMN "source" "LocationSource" NOT NULL DEFAULT 'client';
-- Existing demo data: positions of seeded accounts were written by the seed.
UPDATE "user_locations" ul SET "source" = 'seed' FROM "users" u WHERE u."id" = ul."user_id" AND u."is_seed";
