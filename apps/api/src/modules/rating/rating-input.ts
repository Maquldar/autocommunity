import type { Prisma, PrismaClient } from '@prisma/client';
import { RATING_FORMULA, type RatingInput } from '@autoc/shared';

type Db = Prisma.TransactionClient | PrismaClient;
const DAY_MS = 24 * 3600 * 1000;
/** Helps for / reviews from the same counterpart count at most once per this many days (anti-farming). */
export const COUNTERPART_WINDOW_DAYS = 30;

/** Keeps, per counterpart, only rows at least COUNTERPART_WINDOW_DAYS after the previously kept one (oldest first). */
function oncePerCounterpart<T extends { counterpartId: string; at: Date }>(rows: T[]): T[] {
  const lastKept = new Map<string, number>();
  const window = COUNTERPART_WINDOW_DAYS * DAY_MS;
  return [...rows]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .filter((r) => {
      const prev = lastKept.get(r.counterpartId);
      if (prev !== undefined && r.at.getTime() - prev < window) return false;
      lastKept.set(r.counterpartId, r.at.getTime());
      return true;
    });
}

/**
 * Everything computeRating needs for one user, as of `now` (data after `now` is ignored, so a fake clock in
 * tests and the seed behave like a real one). Active days are calendar days in Asia/Almaty.
 * Anti-farming: SOS marked fake count neither as helps nor for their reviews, and each counterpart (the
 * requester helped / the review author) counts at most once per 30 days.
 */
export async function loadRatingInput(db: Db, userId: string, now: Date): Promise<RatingInput | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { onboardedAt: true } });
  if (!user) return null;
  const since30 = new Date(now.getTime() - RATING_FORMULA.activity.windowDays * DAY_MS);
  const sinceVotes = new Date(now.getTime() - RATING_FORMULA.votes.windowDays * DAY_MS);
  const [helps, reviews, activity, penalties, votes] = await Promise.all([
    db.$queryRaw<{ closedAt: Date; requesterStars: number | null; counterpartId: string }[]>`
      SELECT s.closed_at AS "closedAt", rv.stars AS "requesterStars", s.user_id AS "counterpartId"
      FROM sos_responses r
      JOIN sos_requests s ON s.id = r.sos_id
      LEFT JOIN reviews rv ON rv.ref_id = s.id AND rv.author_id = s.user_id AND rv.target_type = 'user' AND rv.target_id = r.helper_id
                          AND rv.created_at <= ${now}
      WHERE r.helper_id = ${userId}::uuid AND r.status = 'arrived' AND s.status = 'closed' AND NOT s.is_fake AND s.closed_at <= ${now}`,
    db.$queryRaw<{ stars: number; counterpartId: string; createdAt: Date }[]>`
      SELECT rv.stars, rv.author_id AS "counterpartId", rv.created_at AS "createdAt"
      FROM reviews rv
      LEFT JOIN sos_requests s ON s.id = rv.ref_id
      WHERE rv.target_type = 'user' AND rv.target_id = ${userId}::uuid AND rv.created_at <= ${now} AND NOT coalesce(s.is_fake, false)`,
    db.$queryRaw<{ days: number }[]>`
      SELECT count(DISTINCT d)::int AS days FROM (
        SELECT ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Almaty')::date AS d FROM messages
          WHERE sender_id = ${userId}::uuid AND type <> 'system' AND created_at > ${since30} AND created_at <= ${now}
        UNION ALL
        SELECT ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Almaty')::date FROM sos_responses
          WHERE helper_id = ${userId}::uuid AND created_at > ${since30} AND created_at <= ${now}
        UNION ALL
        SELECT ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Almaty')::date FROM sos_requests
          WHERE user_id = ${userId}::uuid AND created_at > ${since30} AND created_at <= ${now}
        UNION ALL
        SELECT ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Almaty')::date FROM reviews
          WHERE author_id = ${userId}::uuid AND created_at > ${since30} AND created_at <= ${now}
      ) x`,
    // A penalty stops counting once a later `penalty_reversed` row with the same kind and refId exists.
    db.$queryRaw<{ points: number; createdAt: Date; kind: string | null }[]>`
      SELECT p.penalty_points AS points, p.created_at AS "createdAt", p.penalty_kind AS kind FROM rating_events p
      WHERE p.user_id = ${userId}::uuid AND p.penalty_points IS NOT NULL AND p.created_at <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM rating_events r
          WHERE r.user_id = p.user_id AND r.reason = 'penalty_reversed' AND r.ref_id = p.ref_id
            AND r.penalty_kind IS NOT DISTINCT FROM p.penalty_kind AND r.created_at >= p.created_at AND r.created_at <= ${now})`,
    db.$queryRaw<{ value: number; weight: number; createdAt: Date }[]>`
      SELECT value::int AS value, weight, created_at AS "createdAt" FROM user_votes
      WHERE target_id = ${userId}::uuid AND created_at > ${sinceVotes} AND created_at <= ${now}`,
  ]);
  return {
    onboardedAt: user.onboardedAt && user.onboardedAt <= now ? user.onboardedAt : user.onboardedAt ? now : null,
    helps: oncePerCounterpart(helps.map((h) => ({ ...h, at: h.closedAt }))).map((h) => ({ closedAt: h.closedAt, requesterStars: h.requesterStars })),
    reviewStars: oncePerCounterpart(reviews.map((r) => ({ ...r, at: r.createdAt }))).map((r) => r.stars),
    activeDays30: activity[0]?.days ?? 0,
    penalties,
    votes,
  };
}
