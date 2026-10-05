-- Penalty ledger rows carry their own points (delta stays "new rating − old rating").
ALTER TABLE "rating_events" ADD COLUMN "penalty_points" INTEGER;
ALTER TABLE "rating_events" ADD COLUMN "penalty_kind" TEXT;
CREATE INDEX "rating_events_penalties_idx" ON "rating_events" ("user_id", "created_at") WHERE "penalty_points" IS NOT NULL;

-- Reviews of an SOS (canReview / help quality lookups).
CREATE INDEX "reviews_ref_id_idx" ON "reviews"("ref_id");

-- One open report per reporter + target (409 ALREADY_REPORTED, also under concurrent requests).
CREATE UNIQUE INDEX "reports_one_open_per_target" ON "reports" ("reporter_id", "target_type", "target_id") WHERE "status" = 'open';

-- Activity component of the rating: messages sent by a user in a time window.
CREATE INDEX "messages_sender_id_created_at_idx" ON "messages" ("sender_id", "created_at");
