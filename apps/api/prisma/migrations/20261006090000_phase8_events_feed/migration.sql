-- Phase 8: events & feed. The tables exist since the initial migration; this adds what the API needs.

-- Distinct voters per poll (votes are final, incremented in the vote transaction).
ALTER TABLE "polls" ADD COLUMN "total_voters" INTEGER NOT NULL DEFAULT 0;

-- An upload can be attached to one post only: the attach check looks posts up by upload id.
CREATE INDEX "posts_media_upload_ids_idx" ON "posts" USING GIN ("media_upload_ids");

-- Participants list (going / interested, oldest first).
CREATE INDEX "event_participants_event_id_status_created_at_idx" ON "event_participants"("event_id", "status", "created_at");
