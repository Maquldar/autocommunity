import type { Prisma } from '@prisma/client';
import { bayesianServiceRating } from '@autoc/shared';

/**
 * Recomputes rating / reviewCount / visitCount of one service from its verified rows. Call inside the
 * transaction that changed a review or visit, after locking the service row (`lockService`).
 */
export async function recomputeServiceStats(tx: Prisma.TransactionClient, serviceId: string): Promise<void> {
  const [agg] = await tx.$queryRaw<{ reviews: number; stars: number; visits: number }[]>`
    SELECT
      (SELECT count(*)::int FROM reviews r
         JOIN service_visits v ON v.id = r.ref_id AND v.status = 'verified'
        WHERE r.target_type = 'service' AND r.target_id = ${serviceId}::uuid) AS reviews,
      (SELECT coalesce(sum(r.stars), 0)::int FROM reviews r
         JOIN service_visits v ON v.id = r.ref_id AND v.status = 'verified'
        WHERE r.target_type = 'service' AND r.target_id = ${serviceId}::uuid) AS stars,
      (SELECT count(*)::int FROM service_visits WHERE service_id = ${serviceId}::uuid AND status = 'verified') AS visits`;
  const reviews = agg?.reviews ?? 0;
  await tx.serviceCenter.update({
    where: { id: serviceId },
    data: { rating: bayesianServiceRating(agg?.stars ?? 0, reviews), reviewCount: reviews, visitCount: agg?.visits ?? 0 },
  });
}

/** Row lock on the service: serializes visit/review writes (limits, cooldowns, stats) per service. */
export async function lockService(
  tx: Prisma.TransactionClient,
  serviceId: string,
): Promise<{ id: string; status: string; qrSecret: string } | null> {
  const [row] = await tx.$queryRaw<{ id: string; status: string; qrSecret: string }[]>`
    SELECT id, status::text AS status, qr_secret AS "qrSecret" FROM service_centers WHERE id = ${serviceId}::uuid FOR UPDATE`;
  return row ?? null;
}
