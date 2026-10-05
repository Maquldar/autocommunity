-- Community search by name substring (GET /communities?q=)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Names are unique among non-deleted communities, case-insensitively (409 COMMUNITY_NAME_TAKEN).
CREATE UNIQUE INDEX "communities_name_lower_active_key" ON "communities" (lower("name")) WHERE "deleted_at" IS NULL;
CREATE INDEX "communities_name_trgm_idx" ON "communities" USING GIN (lower("name") gin_trgm_ops) WHERE "deleted_at" IS NULL;
-- Default listing order: memberCount desc, name
CREATE INDEX "communities_listing_idx" ON "communities" ("member_count" DESC, "name", "id") WHERE "deleted_at" IS NULL;
-- Communities a user owns (COMMUNITY_LIMIT)
CREATE INDEX "communities_owner_id_idx" ON "communities" ("owner_id") WHERE "deleted_at" IS NULL;

-- memberCount never goes negative
ALTER TABLE "communities" ADD CONSTRAINT "communities_member_count_nonneg" CHECK ("member_count" >= 0);
