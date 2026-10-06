import { Injectable } from '@nestjs/common';
import type { AdminStatsDto } from '@autoc/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Dashboard numbers: the PLAN §8 MVP metrics the data supports, in one round of aggregate queries. */
@Injectable()
export class AdminStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<AdminStatsDto> {
    const [row] = await this.prisma.$queryRaw<
      {
        total: number;
        active7d: number;
        new7d: number;
        blocked: number;
        sosOpen: number;
        sos7d: number;
        closed7d: number;
        median: number | null;
        sos30d: number;
        fake30d: number;
        reportsOpen: number;
        servicesPending: number;
        visitsPending: number;
        communities: number;
      }[]
    >`
      SELECT
        (SELECT count(*)::int FROM users WHERE status <> 'deleted') AS total,
        (SELECT count(*)::int FROM users WHERE status <> 'deleted' AND last_active_at > now() - interval '7 days') AS "active7d",
        (SELECT count(*)::int FROM users WHERE status <> 'deleted' AND created_at > now() - interval '7 days') AS "new7d",
        (SELECT count(*)::int FROM users WHERE status = 'blocked' AND (blocked_until IS NULL OR blocked_until > now())) AS blocked,
        (SELECT count(*)::int FROM sos_requests WHERE status IN ('created', 'accepted', 'in_progress')) AS "sosOpen",
        (SELECT count(*)::int FROM sos_requests WHERE created_at > now() - interval '7 days') AS "sos7d",
        (SELECT count(*)::int FROM sos_requests WHERE status = 'closed' AND closed_at > now() - interval '7 days') AS "closed7d",
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY first_sec)
           FROM (SELECT EXTRACT(EPOCH FROM (min(r.created_at) - s.created_at)) AS first_sec
                 FROM sos_requests s JOIN sos_responses r ON r.sos_id = s.id
                 WHERE s.created_at > now() - interval '7 days'
                 GROUP BY s.id, s.created_at) t) AS median,
        (SELECT count(*)::int FROM sos_requests WHERE created_at > now() - interval '30 days') AS "sos30d",
        (SELECT count(*)::int FROM sos_requests WHERE created_at > now() - interval '30 days' AND is_fake) AS "fake30d",
        (SELECT count(*)::int FROM reports WHERE status = 'open') AS "reportsOpen",
        (SELECT count(*)::int FROM service_centers WHERE status = 'pending') AS "servicesPending",
        (SELECT count(*)::int FROM service_visits WHERE status = 'pending' AND method = 'photo') AS "visitsPending",
        (SELECT count(*)::int FROM communities WHERE deleted_at IS NULL) AS communities`;
    const r = row!;
    return {
      users: { total: r.total, active7d: r.active7d, new7d: r.new7d, blocked: r.blocked },
      sos: {
        open: r.sosOpen,
        last7d: r.sos7d,
        closed7d: r.closed7d,
        medianFirstResponseSec7d: r.median === null ? null : Math.round(Number(r.median)),
        fakeRate30d: r.sos30d ? Math.round((r.fake30d / r.sos30d) * 1000) / 1000 : 0,
      },
      reports: { open: r.reportsOpen },
      services: { pending: r.servicesPending },
      visits: { pending: r.visitsPending },
      communities: { total: r.communities },
    };
  }
}
