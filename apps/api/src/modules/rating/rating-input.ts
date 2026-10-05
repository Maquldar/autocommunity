import type { Prisma, PrismaClient } from '@prisma/client';
import { RATING_FORMULA, type RatingInput } from '@autoc/shared';

type Db = Prisma.TransactionClient | PrismaClient;
const DAY_MS = 24 * 3600 * 1000;

/**
 * Everything computeRating needs for one user, as of `now` (data after `now` is ignored, so a fake clock in
 * tests and the seed behave like a real one). Active days are calendar days in Asia/Almaty.
 */
export async function loadRatingInput(db: Db, userId: string, now: Date): Promise<RatingInput | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { onboardedAt: true } });
  if (!user) return null;
  const since30 = new Date(now.getTime() - RATING_FORMULA.activity.windowDays * DAY_MS);
  const [helps, reviews, activity, penalties] = await Promise.all([
    db.$queryRaw<{ closedAt: Date; requesterStars: number | null }[]>`
      SELECT s.closed_at AS "closedAt", rv.stars AS "requesterStars"
      FROM sos_responses r
      JOIN sos_requests s ON s.id = r.sos_id
      LEFT JOIN reviews rv ON rv.ref_id = s.id AND rv.author_id = s.user_id AND rv.target_type = 'user' AND rv.target_id = r.helper_id
                          AND rv.created_at <= ${now}
      WHERE r.helper_id = ${userId}::uuid AND r.status = 'arrived' AND s.status = 'closed' AND s.closed_at <= ${now}`,
    db.$queryRaw<{ stars: number }[]>`
      SELECT stars FROM reviews WHERE target_type = 'user' AND target_id = ${userId}::uuid AND created_at <= ${now}`,
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
    db.$queryRaw<{ points: number; createdAt: Date }[]>`
      SELECT penalty_points AS points, created_at AS "createdAt" FROM rating_events
      WHERE user_id = ${userId}::uuid AND penalty_points IS NOT NULL AND created_at <= ${now}`,
  ]);
  return {
    onboardedAt: user.onboardedAt && user.onboardedAt <= now ? user.onboardedAt : user.onboardedAt ? now : null,
    helps,
    reviewStars: reviews.map((r) => r.stars),
    activeDays30: activity[0]?.days ?? 0,
    penalties,
  };
}
