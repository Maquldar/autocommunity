import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  bayesianServiceRating,
  isOpenAt,
  normalizeHours,
  SERVICE_LIMITS,
  type CreateServiceData,
  type MyVisit,
  type Paginated,
  type ServiceCategory,
  type ServiceDto,
  type ServiceListItem,
  type ServiceListQuery,
  type ServiceMapQuery,
  type ServiceMapResult,
  type ServiceQrDto,
  type ServiceStatus,
} from '@autoc/shared';
import { randomBytes } from 'node:crypto';
import type { AuthUser } from '../../common/auth/decorators';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
import { Storage } from '../../infra/storage/storage';
import { toUploadDto } from '../uploads/upload.mapper';
import { UploadsService } from '../uploads/uploads.service';
import { currentQrCode } from './qr';
import { decodeServiceCursor, encodeServiceCursor, type ServiceCursor } from './service-cursor';

/** Columns every service read needs; `location` is split into lat/lng. */
const SERVICE_COLUMNS = Prisma.sql`
  s.id, s.name, s.category::text AS category, s.description, s.address, s.phone, s.hours,
  s.photo_upload_ids AS "photoUploadIds", s.rating, s.review_count AS "reviewCount", s.visit_count AS "visitCount",
  s.status::text AS status, s.submitted_by_id AS "submittedById",
  ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng`;

type ServiceRow = {
  id: string;
  name: string;
  category: ServiceCategory;
  description: string;
  address: string;
  phone: string | null;
  hours: unknown;
  photoUploadIds: string[];
  rating: number;
  reviewCount: number;
  visitCount: number;
  status: ServiceStatus;
  submittedById: string | null;
  lat: number;
  lng: number;
  distance: number | null;
};

type ListRow = ServiceRow & { photoKey: string | null; photoThumbKey: string | null };

const point = (lat: number, lng: number) =>
  Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography`;

/** Escapes LIKE wildcards so user input is matched literally. */
const likeContains = (q: string) => `%${q.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;

/** Lowercase letters and digits only, for the duplicate-name comparison ("СТО «Мотор»" → "стомотор"). */
export const nameKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Same or containing names (ignoring case, spaces and punctuation); containment needs ≥ 4 characters. */
export function similarNames(a: string, b: string): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && long.includes(short);
}

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
    private readonly uploads: UploadsService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  /* ------------------------------------------------------------------ list */

  async list(query: ServiceListQuery): Promise<Paginated<ServiceListItem>> {
    const hasLocation = query.lat !== undefined && query.lng !== undefined;
    const sort: ServiceCursor['sort'] = query.sort ?? (hasLocation ? 'distance' : 'rating');
    const after = decodeServiceCursor(query.cursor, sort);
    const here = hasLocation ? point(query.lat!, query.lng!) : null;
    const distance = here ? Prisma.sql`ST_Distance(s.location, ${here})` : Prisma.sql`NULL::float8`;

    const conds: Prisma.Sql[] = [Prisma.sql`s.status = 'verified'`];
    if (query.category) conds.push(Prisma.sql`s.category = ${query.category}::"ServiceCategory"`);
    if (query.q) {
      const pattern = likeContains(query.q);
      conds.push(Prisma.sql`(lower(s.name) LIKE ${pattern} ESCAPE '\\' OR lower(s.address) LIKE ${pattern} ESCAPE '\\')`);
    }
    let order: Prisma.Sql;
    if (sort === 'distance') {
      if (after?.sort === 'distance') conds.push(Prisma.sql`(${distance}, s.id) > (${after.distance}::float8, ${after.id}::uuid)`);
      order = Prisma.sql`ORDER BY 1 ASC, s.id ASC`;
    } else {
      if (after?.sort === 'rating') {
        conds.push(
          Prisma.sql`(s.rating, s.review_count, s.id) < (${after.rating}::float8, ${after.reviewCount}::int, ${after.id}::uuid)`,
        );
      }
      order = Prisma.sql`ORDER BY s.rating DESC, s.review_count DESC, s.id DESC`;
    }

    // Column 1 is the distance so ORDER BY 1 sorts by the same expression the cursor compares.
    const rows = await this.prisma.$queryRaw<ListRow[]>`
      SELECT ${distance} AS distance, ${SERVICE_COLUMNS}, p.key AS "photoKey", p.thumb_key AS "photoThumbKey"
      FROM service_centers s
      LEFT JOIN uploads p ON p.id = s.photo_upload_ids[1]
      WHERE ${Prisma.join(conds, ' AND ')}
      ${order}
      LIMIT ${query.limit + 1}`;

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    let nextCursor: string | null = null;
    if (hasMore && last) {
      nextCursor =
        sort === 'distance'
          ? encodeServiceCursor({ sort, distance: last.distance!, id: last.id })
          : encodeServiceCursor({ sort, rating: last.rating, reviewCount: last.reviewCount, id: last.id });
    }
    const now = new Date();
    return {
      items: page.map((r) => ({
        ...this.baseFields(r, now),
        photoUrl: r.photoKey ? this.storage.publicUrl(r.photoThumbKey ?? r.photoKey) : null,
      })),
      nextCursor,
    };
  }

  /* ------------------------------------------------------------------ map */

  async map(query: ServiceMapQuery): Promise<ServiceMapResult> {
    const { minLng, minLat, maxLng, maxLat } = query.bbox;
    if (maxLng - minLng > SERVICE_LIMITS.mapMaxSpanDeg || maxLat - minLat > SERVICE_LIMITS.mapMaxSpanDeg) {
      throw Errors.badRequest('BBOX_TOO_LARGE', `bbox may cover at most ${SERVICE_LIMITS.mapMaxSpanDeg}° × ${SERVICE_LIMITS.mapMaxSpanDeg}°`);
    }
    const category = query.category ? Prisma.sql`AND category = ${query.category}::"ServiceCategory"` : Prisma.empty;
    // `&&` against the envelope is answered by the GiST index on location.
    const rows = await this.prisma.$queryRaw<ServiceMapResult['items']>`
      SELECT id, name, category::text AS category, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, rating
      FROM service_centers
      WHERE status = 'verified'
        AND location && ST_MakeEnvelope(${minLng}::float8, ${minLat}::float8, ${maxLng}::float8, ${maxLat}::float8, 4326)::geography
        ${category}
      ORDER BY rating DESC, review_count DESC, id DESC
      LIMIT ${SERVICE_LIMITS.mapMax + 1}`;
    return { items: rows.slice(0, SERVICE_LIMITS.mapMax), truncated: rows.length > SERVICE_LIMITS.mapMax };
  }

  /* ------------------------------------------------------------------ details */

  /** Loads a service the viewer may see: verified, or pending/rejected for its submitter and admins. 404 otherwise. */
  async requireVisible(viewer: AuthUser, id: string, at?: { lat: number; lng: number }): Promise<ServiceRow> {
    const distance = at ? Prisma.sql`ST_Distance(s.location, ${point(at.lat, at.lng)})` : Prisma.sql`NULL::float8`;
    const [row] = await this.prisma.$queryRaw<ServiceRow[]>`
      SELECT ${SERVICE_COLUMNS}, ${distance} AS distance FROM service_centers s WHERE s.id = ${id}::uuid`;
    if (!row) throw Errors.notFound('Service not found');
    const canSee = row.status === 'verified' || row.submittedById === viewer.id || viewer.role === 'admin';
    if (!canSee) throw Errors.notFound('Service not found');
    return row;
  }

  async details(viewer: AuthUser, id: string, at?: { lat: number; lng: number }): Promise<ServiceDto> {
    return this.toDto(viewer.id, await this.requireVisible(viewer, id, at));
  }

  async toDto(viewerId: string, row: ServiceRow): Promise<ServiceDto> {
    const [uploads, myVisit] = await Promise.all([
      row.photoUploadIds.length ? this.prisma.upload.findMany({ where: { id: { in: row.photoUploadIds } } }) : [],
      this.myVisit(viewerId, row.id),
    ]);
    const byId = new Map(uploads.map((u) => [u.id, u]));
    const photos = row.photoUploadIds.flatMap((pid) => {
      const u = byId.get(pid);
      return u ? [toUploadDto(u, this.storage)] : [];
    });
    return {
      ...this.baseFields(row, new Date()),
      description: row.description,
      hours: normalizeHours(row.hours),
      photos,
      myVisit,
    };
  }

  private async myVisit(userId: string, serviceId: string): Promise<MyVisit | null> {
    const visit = await this.prisma.serviceVisit.findFirst({
      where: { userId, serviceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!visit) return null;
    const review = await this.prisma.review.findFirst({
      where: { targetType: 'service', targetId: serviceId, refId: visit.id },
      select: { id: true },
    });
    return {
      id: visit.id,
      method: visit.method,
      status: visit.status,
      createdAt: visit.createdAt.toISOString(),
      reviewed: review !== null,
    };
  }

  private baseFields(r: ServiceRow, now: Date): Omit<ServiceListItem, 'photoUrl'> {
    return {
      id: r.id,
      name: r.name,
      category: r.category,
      address: r.address,
      phone: r.phone,
      lat: r.lat,
      lng: r.lng,
      rating: r.rating,
      reviewCount: r.reviewCount,
      visitCount: r.visitCount,
      status: r.status,
      distanceM: r.distance === null || r.distance === undefined ? null : Math.round(r.distance),
      openNow: isOpenAt(normalizeHours(r.hours), now),
    };
  }

  /* ------------------------------------------------------------------ submit */

  async create(viewer: AuthUser, input: CreateServiceData): Promise<ServiceDto> {
    // Counts accepted submissions only: the slot is refunded when the submission is refused below.
    const hit = await this.rateLimiter.reserveOrThrow([
      { key: `svc:submit:${viewer.id}`, limit: SERVICE_LIMITS.submissionsPerDay, windowSec: 86_400 },
    ]);
    try {
      const photoIds = [...new Set(input.photoUploadIds)];
      for (const uploadId of photoIds) await this.uploads.requireOwn(viewer.id, uploadId, ['service']);
      const id = newId();
      await this.prisma.$transaction(async (tx) => {
        // Serializes concurrent submissions so two identical ones can't both pass the duplicate check.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('service_centers:submit'))`;
        const nearby = await tx.$queryRaw<{ id: string; name: string; status: ServiceStatus; submittedById: string | null }[]>`
          SELECT id, name, status::text AS status, submitted_by_id AS "submittedById"
          FROM service_centers
          WHERE category = ${input.category}::"ServiceCategory"
            AND status IN ('pending', 'verified')
            AND ST_DWithin(location, ${point(input.lat, input.lng)}, ${SERVICE_LIMITS.duplicateRadiusM})`;
        const dup = nearby.find((s) => similarNames(s.name, input.name));
        if (dup) {
          // Only point at the existing entry when the caller could open it.
          const visible = dup.status === 'verified' || dup.submittedById === viewer.id;
          throw Errors.conflict('SERVICE_DUPLICATE', 'This service is already listed', visible ? { serviceId: dup.id } : undefined);
        }
        await tx.$executeRaw`
          INSERT INTO service_centers
            (id, name, category, description, address, phone, hours, photo_upload_ids, location, rating, status, qr_secret,
             submitted_by_id, created_at, updated_at)
          VALUES (${id}::uuid, ${input.name}, ${input.category}::"ServiceCategory", ${input.description}, ${input.address},
                  ${input.phone}, ${JSON.stringify(input.hours)}::jsonb, ${photoIds}::uuid[], ${point(input.lat, input.lng)},
                  ${bayesianServiceRating(0, 0)}, 'pending', ${randomBytes(32).toString('hex')}, ${viewer.id}::uuid, now(), now())`;
      });
      return this.details(viewer, id);
    } catch (err) {
      await this.rateLimiter.refund(hit);
      throw err;
    }
  }

  /* ------------------------------------------------------------------ QR (admin) */

  async qr(id: string): Promise<ServiceQrDto> {
    const service = await this.prisma.serviceCenter.findUnique({ where: { id }, select: { qrSecret: true } });
    if (!service) throw Errors.notFound('Service not found');
    return { code: currentQrCode(service.qrSecret), validFor: 'today' };
  }
}
