-- Last change of an SOS (public share endpoint `updatedAt`).
ALTER TABLE "sos_requests" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- At most one open SOS per user (409 SOS_ALREADY_OPEN, also under concurrent creates).
CREATE UNIQUE INDEX "sos_requests_one_open_per_user" ON "sos_requests" ("user_id") WHERE "status" IN ('created', 'accepted', 'in_progress');

-- Active helps of a helper (accepted/arrived) — checked against open SOS when accepting.
CREATE INDEX "sos_responses_active_helper_idx" ON "sos_responses" ("helper_id") WHERE "status" IN ('accepted', 'arrived');

-- Dispatch log by user (visibility, socket room auto-join).
CREATE INDEX "sos_dispatches_user_id_idx" ON "sos_dispatches" ("user_id");

-- Expiry sweep: open SOS still waiting by expiry time.
CREATE INDEX "sos_requests_created_expires_idx" ON "sos_requests" ("expires_at") WHERE "status" = 'created';
