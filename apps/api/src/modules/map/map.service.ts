import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MapUser, MapUsersQuery } from '@autoc/shared';
import { Errors } from '../../common/errors/api-exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
import { Storage } from '../../infra/storage/storage';

export const MAP_MAX_USERS = 500;
/** Largest bbox side, in degrees. */
export const MAP_MAX_BBOX_DEG = 2;
/** Positions older than this are not shown. */
export const LOCATION_FRESH_MINUTES = 15;
/**
 * Grid for approximate positions: cells are GRID_CELL_DEG of latitude high (~500 m) and, per latitude band,
 * GRID_CELL_DEG / cos(lat) of longitude wide (~500 m), so they stay roughly square anywhere.
 */
export const GRID_CELL_DEG = 0.0045;
/** GET /map/users per user per minute. */
export const MAP_REQUESTS_PER_MINUTE = 60;

type Row = {
  userId: string;
  nickname: string | null;
  rating: number;
  updatedAt: Date;
  lat: number;
  lng: number;
  approximate: boolean;
  relation: MapUser['relation'];
  avatarKey: string | null;
  avatarThumbKey: string | null;
  brand: string | null;
  model: string | null;
};

export type MapFilters = { friendsOnly: boolean; communityIds: string[]; brand: string | null };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

@Injectable()
export class MapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async users(viewerId: string, query: MapUsersQuery): Promise<{ items: MapUser[]; truncated: boolean }> {
    const viewer = await this.prisma.user.findUniqueOrThrow({ where: { id: viewerId }, select: { onboardedAt: true } });
    if (!viewer.onboardedAt) throw Errors.forbidden('Complete your profile to see the map', 'ONBOARDING_INCOMPLETE');
    await this.rateLimiter.consumeOrThrow([{ key: `map:${viewerId}`, limit: MAP_REQUESTS_PER_MINUTE, windowSec: 60 }]);
    const { minLng, minLat, maxLng, maxLat } = query.bbox;
    if (maxLng - minLng > MAP_MAX_BBOX_DEG || maxLat - minLat > MAP_MAX_BBOX_DEG) {
      throw Errors.badRequest('BBOX_TOO_LARGE', `The map area may cover at most ${MAP_MAX_BBOX_DEG}° × ${MAP_MAX_BBOX_DEG}°`);
    }
    const communityIds = [...new Set(query.communityIds ?? [])];
    if (communityIds.length) await this.assertActiveMember(viewerId, communityIds);

    const rows = await this.prisma.$queryRaw<Row[]>(
      this.buildQuery(viewerId, query.bbox, { friendsOnly: query.friends === true, communityIds, brand: query.brand ?? null }),
    );
    const truncated = rows.length > MAP_MAX_USERS;
    return {
      items: rows.slice(0, MAP_MAX_USERS).map((r) => ({
        userId: r.userId,
        nickname: r.nickname ?? '',
        avatarUrl: r.avatarKey ? this.storage.publicUrl(r.avatarThumbKey ?? r.avatarKey) : null,
        rating: r.rating,
        vehicle: r.brand && r.model ? { brand: r.brand, model: r.model } : null,
        lat: r.lat,
        lng: r.lng,
        approximate: r.approximate,
        relation: r.relation,
        updatedAt: r.updatedAt.toISOString(),
      })),
      truncated,
    };
  }

  /** `communityIds` is only honoured for communities the viewer actively belongs to. */
  private async assertActiveMember(viewerId: string, communityIds: string[]): Promise<void> {
    const count = await this.prisma.communityMember.count({
      where: { userId: viewerId, status: 'active', communityId: { in: communityIds }, community: { deletedAt: null } },
    });
    if (count !== communityIds.length) throw Errors.forbidden('You are not an active member of every requested community');
  }

  /**
   * The whole visibility rule (API.md §2, SPEC A-3) runs in this one statement, so rows the viewer may not
   * see never leave the database:
   * - friend_ids / co_member_ids: the viewer's accepted friends and active co-members of live communities
   *   (`via_private`: they share at least one *private* community, whose membership is approval-gated);
   * - candidates: GiST bbox pre-filter (`&&` on the geography index) on an envelope widened by one grid
   *   cell, freshness, account state and the privacy-mode rule, plus the optional filters;
   * - placed: friends and co-members of a shared private community keep exact coordinates; everyone else
   *   (including co-members of public communities only) is snapped to the centre of their ~500 m grid cell,
   *   and their `updatedAt` is rounded down to the minute;
   * - page: the bbox test runs on the *returned* point — testing the exact point would let a client find a
   *   stranger's precise position by moving the bbox edge;
   * - the final select joins avatar and primary vehicle (unique partial index: at most one) — no N+1.
   */
  buildQuery(viewerId: string, bbox: MapUsersQuery['bbox'], filters: MapFilters): Prisma.Sql {
    const { minLng, minLat, maxLng, maxLat } = bbox;
    const S = GRID_CELL_DEG;
    const H = S / 2;
    // Margin of one cell so strangers whose snapped point falls inside the bbox are candidates.
    const lngMargin = S / Math.cos((Math.min(85, Math.max(Math.abs(minLat), Math.abs(maxLat)) + S) * Math.PI) / 180);
    const env = {
      minLng: clamp(minLng - lngMargin, -180, 180),
      maxLng: clamp(maxLng + lngMargin, -180, 180),
      minLat: clamp(minLat - S, -90, 90),
      maxLat: clamp(maxLat + S, -90, 90),
    };
    const viewer = Prisma.sql`${viewerId}::uuid`;
    const extra: Prisma.Sql[] = [];
    if (filters.friendsOnly) extra.push(Prisma.sql`AND fr.user_id IS NOT NULL`);
    if (filters.communityIds.length) {
      extra.push(Prisma.sql`AND EXISTS (
        SELECT 1 FROM community_members fm
        WHERE fm.user_id = ul.user_id AND fm.status = 'active' AND fm.community_id = ANY(${filters.communityIds}::uuid[]))`);
    }
    if (filters.brand) {
      extra.push(Prisma.sql`AND EXISTS (
        SELECT 1 FROM vehicles bv
        WHERE bv.user_id = ul.user_id AND bv.is_primary AND lower(bv.brand) = lower(${filters.brand}))`);
    }

    return Prisma.sql`
      WITH friend_ids AS (
        SELECT CASE WHEN f.requester_id = ${viewer} THEN f.addressee_id ELSE f.requester_id END AS user_id
        FROM friendships f
        WHERE f.status = 'accepted' AND (f.requester_id = ${viewer} OR f.addressee_id = ${viewer})
      ),
      co_member_ids AS (
        SELECT other.user_id, bool_or(c.is_private) AS via_private
        FROM community_members mine
        JOIN communities c ON c.id = mine.community_id AND c.deleted_at IS NULL
        JOIN community_members other ON other.community_id = mine.community_id AND other.status = 'active'
        WHERE mine.user_id = ${viewer} AND mine.status = 'active' AND other.user_id <> ${viewer}
        GROUP BY other.user_id
      ),
      candidates AS (
        SELECT ul.user_id, ul.updated_at, ul.location::geometry AS geom,
               u.nickname, u.rating, u.avatar_upload_id,
               fr.user_id IS NOT NULL AS is_friend,
               cm.user_id IS NOT NULL AS is_co_member,
               coalesce(cm.via_private, false) AS via_private
        FROM user_locations ul
        JOIN users u ON u.id = ul.user_id
        LEFT JOIN friend_ids fr ON fr.user_id = ul.user_id
        LEFT JOIN co_member_ids cm ON cm.user_id = ul.user_id
        WHERE ul.location && ST_MakeEnvelope(${env.minLng}::float8, ${env.minLat}::float8, ${env.maxLng}::float8, ${env.maxLat}::float8, 4326)::geography
          AND ul.updated_at > now() - make_interval(mins => ${LOCATION_FRESH_MINUTES}::int)
          AND ul.user_id <> ${viewer}
          AND u.onboarded_at IS NOT NULL
          AND (u.status = 'active' OR (u.status = 'blocked' AND u.blocked_until <= now()))
          AND (
            u.privacy_mode = 'everyone'
            OR (u.privacy_mode IN ('friends', 'community') AND fr.user_id IS NOT NULL)
            OR (u.privacy_mode = 'community' AND cm.user_id IS NOT NULL)
          )
          ${extra.length ? Prisma.join(extra, ' ') : Prisma.empty}
      ),
      placed AS (
        SELECT c.*,
               (c.is_friend OR c.via_private) AS exact,
               CASE WHEN c.is_friend OR c.via_private THEN c.geom
                    ELSE ST_SnapToGrid(c.geom, cell.width / 2, ${H}::float8, cell.width, ${S}::float8)
               END AS pt,
               CASE WHEN c.is_friend OR c.via_private THEN c.updated_at ELSE date_trunc('minute', c.updated_at) END AS shown_at
        FROM candidates c
        CROSS JOIN LATERAL (
          -- Longitude width of the cell row the point falls in (row centres: H + k·S, as ST_SnapToGrid rounds).
          SELECT ${S}::float8 / cos(radians(round((ST_Y(c.geom) - ${H}::float8) / ${S}::float8) * ${S}::float8 + ${H}::float8)) AS width
        ) cell
      ),
      page AS (
        SELECT * FROM placed
        WHERE ST_X(pt) BETWEEN ${minLng}::float8 AND ${maxLng}::float8
          AND ST_Y(pt) BETWEEN ${minLat}::float8 AND ${maxLat}::float8
        ORDER BY shown_at DESC, user_id DESC
        LIMIT ${MAP_MAX_USERS + 1}::int
      )
      SELECT p.user_id AS "userId", p.nickname::text AS nickname, p.rating, p.shown_at AS "updatedAt",
             ST_Y(p.pt) AS lat, ST_X(p.pt) AS lng, NOT p.exact AS approximate,
             CASE WHEN p.is_friend THEN 'friend' WHEN p.is_co_member THEN 'community' ELSE 'public' END AS relation,
             up.key AS "avatarKey", up.thumb_key AS "avatarThumbKey", v.brand, v.model
      FROM page p
      LEFT JOIN uploads up ON up.id = p.avatar_upload_id
      LEFT JOIN vehicles v ON v.user_id = p.user_id AND v.is_primary
      ORDER BY p.shown_at DESC, p.user_id DESC`;
  }
}
