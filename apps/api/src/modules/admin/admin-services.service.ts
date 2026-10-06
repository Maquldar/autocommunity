import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AdminServiceDto,
  AdminServiceQrDto,
  AdminVisitDto,
  Paginated,
  ServiceCategory,
  ServiceHours,
  ServiceStatus,
  ServiceStatusPayload,
  VisitStatus,
  VisitStatusPayload,
} from '@autoc/shared';
import { Errors } from '../../common/errors/api-exception';
import { decodeCursor, keysetOrderBy, keysetWhere, splitPage } from '../../common/pagination/cursor';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Storage } from '../../infra/storage/storage';
import { NotificationsService } from '../notifications/notifications.service';
import { currentQrCode } from '../services/qr';
import { lockService, recomputeServiceStats } from '../services/service-rating';
import { toUploadDto } from '../uploads/upload.mapper';
import { AdminAuditService } from './admin-audit.service';
import { invalidTarget, AdminViewService } from './admin-view.service';

type ServiceRaw = {
  id: string;
  name: string;
  category: ServiceCategory;
  description: string;
  address: string;
  phone: string | null;
  hours: ServiceHours;
  photoUploadIds: string[];
  lat: number;
  lng: number;
  status: ServiceStatus;
  rating: number;
  reviewCount: number;
  submittedById: string | null;
  createdAt: Date;
};

const like = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

/** Service submissions and photo visits (Phase 7 data, moderated here). */
@Injectable()
export class AdminServicesService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
    private readonly view: AdminViewService,
    private readonly audit: AdminAuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------------------------------------------ services */

  async list(q: { status?: ServiceStatus; q?: string; cursor?: string; limit: number }): Promise<Paginated<AdminServiceDto>> {
    const after = decodeCursor(q.cursor);
    const rows = await this.rows(Prisma.sql`
      WHERE TRUE
        ${q.status ? Prisma.sql`AND s.status = ${q.status}::"ServiceStatus"` : Prisma.empty}
        ${q.q ? Prisma.sql`AND (s.name ILIKE ${like(q.q)} ESCAPE '\\' OR s.address ILIKE ${like(q.q)} ESCAPE '\\')` : Prisma.empty}
        ${after ? Prisma.sql`AND (s.created_at, s.id) < (${after.createdAt}, ${after.id}::uuid)` : Prisma.empty}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT ${q.limit + 1}::int`);
    const page = splitPage(rows, q.limit);
    return { items: await this.toDtos(page.rows), nextCursor: page.nextCursor };
  }

  async get(id: string): Promise<AdminServiceDto> {
    const [row] = await this.rows(Prisma.sql`WHERE s.id = ${id}::uuid`);
    if (!row) throw Errors.notFound('Service not found');
    return (await this.toDtos([row]))[0]!;
  }

  /** verify | reject → `service_status` notification to the submitter. */
  async setStatus(adminId: string, id: string, status: 'verified' | 'rejected', note: string): Promise<AdminServiceDto> {
    const service = await this.prisma.serviceCenter.findUnique({ where: { id }, select: { status: true, name: true, submittedById: true } });
    if (!service) throw Errors.notFound('Service not found');
    if (service.submittedById === adminId) throw invalidTarget("You can't moderate your own submission");
    if (service.status === status) throw Errors.conflict('SERVICE_STATUS_UNCHANGED', `The service is already ${status}`);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.serviceCenter.updateMany({ where: { id, status: service.status }, data: { status } });
      if (!count) throw Errors.conflict('SERVICE_STATUS_UNCHANGED', 'The service changed in the meantime');
      await this.audit.record(
        { adminId, action: status === 'verified' ? 'service.verify' : 'service.reject', targetType: 'service', targetId: id, targetUserId: service.submittedById, note },
        tx,
      );
    });
    if (service.submittedById) {
      const payload: ServiceStatusPayload = { serviceId: id, serviceName: service.name, status, note };
      await this.notifications.create(service.submittedById, 'service_status', payload);
    }
    return this.get(id);
  }

  /** Today's code plus the URL the printed QR encodes (the visit flow accepts both). */
  async qr(id: string): Promise<AdminServiceQrDto> {
    const service = await this.prisma.serviceCenter.findUnique({ where: { id }, select: { qrSecret: true } });
    if (!service) throw Errors.notFound('Service not found');
    const code = currentQrCode(service.qrSecret);
    return { code, validFor: 'today', url: `${this.env.WEB_ORIGIN[0]}/services/${id}?code=${code}` };
  }

  private rows(tail: Prisma.Sql): Promise<ServiceRaw[]> {
    return this.prisma.$queryRaw<ServiceRaw[]>`
      SELECT s.id, s.name, s.category, s.description, s.address, s.phone, s.hours, s.photo_upload_ids AS "photoUploadIds",
             ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng, s.status, s.rating,
             s.review_count AS "reviewCount", s.submitted_by_id AS "submittedById", s.created_at AS "createdAt"
      FROM service_centers s
      ${tail}`;
  }

  private async toDtos(rows: ServiceRaw[]): Promise<AdminServiceDto[]> {
    const photoIds = rows.flatMap((r) => r.photoUploadIds);
    const [uploads, minis] = await Promise.all([
      photoIds.length ? this.prisma.upload.findMany({ where: { id: { in: photoIds } } }) : Promise.resolve([]),
      this.view.minis(rows.map((r) => r.submittedById)),
    ]);
    const byId = new Map(uploads.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      description: r.description,
      address: r.address,
      phone: r.phone,
      hours: r.hours,
      lat: r.lat,
      lng: r.lng,
      status: r.status,
      rating: Math.round(r.rating * 10) / 10,
      reviewCount: r.reviewCount,
      photos: r.photoUploadIds.flatMap((pid) => {
        const u = byId.get(pid);
        return u ? [toUploadDto(u, this.storage)] : [];
      }),
      submittedBy: r.submittedById ? (minis.get(r.submittedById) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /* ------------------------------------------------------------------ photo visits */

  async visits(q: { status?: VisitStatus; cursor?: string; limit: number }): Promise<Paginated<AdminVisitDto>> {
    const rows = await this.prisma.serviceVisit.findMany({
      where: { method: 'photo', status: q.status ?? 'pending', ...keysetWhere(decodeCursor(q.cursor)) },
      orderBy: keysetOrderBy,
      take: q.limit + 1,
      include: { service: { select: { id: true, name: true, address: true } } },
    });
    const page = splitPage(rows, q.limit);
    return { items: await this.toVisitDtos(page.rows), nextCursor: page.nextCursor };
  }

  /** approve → verified (enables the review; service stats recomputed) | reject; `visit_status` to the user. */
  async setVisitStatus(adminId: string, id: string, status: 'verified' | 'rejected', note: string): Promise<AdminVisitDto> {
    const visit = await this.prisma.serviceVisit.findUnique({ where: { id }, include: { service: { select: { name: true } } } });
    if (!visit) throw Errors.notFound('Visit not found');
    if (visit.userId === adminId) throw invalidTarget("You can't moderate your own visit");
    await this.prisma.$transaction(async (tx) => {
      await lockService(tx, visit.serviceId);
      const { count } = await tx.serviceVisit.updateMany({ where: { id, status: 'pending' }, data: { status } });
      if (!count) throw Errors.conflict('VISIT_NOT_PENDING', 'This visit was already moderated');
      if (status === 'verified') await recomputeServiceStats(tx, visit.serviceId);
      await this.audit.record(
        { adminId, action: status === 'verified' ? 'visit.approve' : 'visit.reject', targetType: 'visit', targetId: id, targetUserId: visit.userId, note },
        tx,
      );
    });
    const payload: VisitStatusPayload = { visitId: id, serviceId: visit.serviceId, serviceName: visit.service.name, status, note };
    await this.notifications.create(visit.userId, 'visit_status', payload);
    const fresh = await this.prisma.serviceVisit.findUniqueOrThrow({ where: { id }, include: { service: { select: { id: true, name: true, address: true } } } });
    return (await this.toVisitDtos([fresh]))[0]!;
  }

  private async toVisitDtos(
    rows: Prisma.ServiceVisitGetPayload<{ include: { service: { select: { id: true; name: true; address: true } } } }>[],
  ): Promise<AdminVisitDto[]> {
    const uploadIds = rows.map((r) => r.uploadId).filter((x): x is string => !!x);
    const [uploads, minis] = await Promise.all([
      uploadIds.length ? this.prisma.upload.findMany({ where: { id: { in: uploadIds } } }) : Promise.resolve([]),
      this.view.minis(rows.map((r) => r.userId)),
    ]);
    const byId = new Map(uploads.map((u) => [u.id, u]));
    return rows.map((r) => {
      const upload = r.uploadId ? byId.get(r.uploadId) : undefined;
      return {
        id: r.id,
        service: r.service,
        user: minis.get(r.userId) ?? { id: r.userId, nickname: '', name: 'Deleted user', avatarUrl: null, rating: 0 },
        method: r.method,
        status: r.status,
        photo: upload ? toUploadDto(upload, this.storage) : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}
