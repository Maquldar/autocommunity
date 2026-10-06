-- Phase 10: vote reasons become a Postgres enum with the driving-specific reasons (API.md §10.2).
-- Generated with `prisma migrate dev --create-only` and edited by hand: the generated SQL dropped and
-- re-added the column (losing every vote) and dropped the hand-written GiST / partial indexes that Prisma
-- can't express. Existing rows are cast in place; every Phase 9 value is a member of the enum.

-- CreateEnum
CREATE TYPE "VoteReason" AS ENUM ('helped_on_road', 'polite', 'good_driver', 'lets_merge', 'careful_driver', 'signals_properly', 'rude', 'dangerous_driving', 'scam', 'cuts_off', 'no_turn_signals', 'speeding', 'tailgating', 'bad_parking', 'aggressive', 'phone_while_driving', 'other');

-- AlterTable: text → enum, keeping the data
ALTER TABLE "user_votes" ALTER COLUMN "reason" TYPE "VoteReason" USING "reason"::"VoteReason";

-- A reason must match the vote's sign (`other` goes with either); the API validates the same rule first.
ALTER TABLE "user_votes" ADD CONSTRAINT "user_votes_reason_sign_check" CHECK (
  "reason" = 'other'
  OR ("value" = 1 AND "reason" IN ('helped_on_road', 'polite', 'good_driver', 'lets_merge', 'careful_driver', 'signals_properly'))
  OR ("value" = -1 AND "reason" IN ('rude', 'dangerous_driving', 'scam', 'cuts_off', 'no_turn_signals', 'speeding', 'tailgating', 'bad_parking', 'aggressive', 'phone_while_driving'))
);
