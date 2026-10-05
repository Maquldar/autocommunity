import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type ServiceVisit } from '@prisma/client';
import { SERVICE_LIMITS, type VisitDto } from '@autoc/shared';
import type { z } from 'zod';
import type { createVisitSchema } from '@autoc/shared';
import type { AuthUser } from '../../common/auth/decorators';
import { ApiException, Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
import { UploadsService } from '../uploads/uploads.service';
import { isValidQrCode } from './qr';
import { lockService, recomputeServiceStats } from './service-rating';

type VisitInput = z.output<typeof createVisitSchema>;

export const toVisitDto = (v: ServiceVisit): VisitDto => ({
  id: v.id,
  serviceId: v.serviceId,
  method: v.method,
  status: v.status,
  distanceM: v.distanceM,
  createdAt: v.createdAt.toISOString(),
});

const unprocessable = (code: string, message: string, details?: unknown) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async create(viewer: AuthUser, serviceId: string, input: VisitInput): Promise<VisitDto> {
    // Every attempt counts (failed QR codes included), which bounds code guessing.
    await this.rateLimiter.consumeOrThrow([
      { key: `svc:visit:${viewer.id}`, limit: SERVICE_LIMITS.visitAttemptsPerHour, windowSec: 3600 },
    ]);
    if (input.method === 'photo') await this.uploads.requireOwn(viewer.id, input.uploadId, ['order']);

    return this.prisma.$transaction(async (tx) => {
      const service = await lockService(tx, serviceId);
      // Visits are only for listed (verified) services.
      if (!service || service.status !== 'verified') throw Errors.notFound('Service not found');

      const since = new Date(Date.now() - SERVICE_LIMITS.visitWindowHours * 3_600_000);
      const recent = await tx.serviceVisit.findFirst({
        where: { userId: viewer.id, serviceId, status: { in: ['pending', 'verified'] }, createdAt: { gt: since } },
        select: { id: true },
      });
      if (recent) throw Errors.conflict('VISIT_EXISTS', 'You already have a visit to this service in the last 24 hours', { visitId: recent.id });

      let status: 'pending' | 'verified';
      let distanceM: number | null = null;
      let uploadId: string | null = null;
      if (input.method === 'geo') {
        const [row] = await tx.$queryRaw<{ d: number }[]>`
          SELECT ST_Distance(location, ST_SetSRID(ST_MakePoint(${input.lng}::float8, ${input.lat}::float8), 4326)::geography) AS d
          FROM service_centers WHERE id = ${serviceId}::uuid`;
        distanceM = Math.round(row!.d);
        if (row!.d > SERVICE_LIMITS.geoVisitRadiusM) {
          throw unprocessable('TOO_FAR', `You need to be within ${SERVICE_LIMITS.geoVisitRadiusM} m of the service`, { distanceM });
        }
        status = 'verified';
      } else if (input.method === 'qr') {
        if (!isValidQrCode(service.qrSecret, input.code)) throw unprocessable('INVALID_QR', 'This code is not valid');
        status = 'verified';
      } else {
        const reused = await tx.serviceVisit.findFirst({ where: { uploadId: input.uploadId }, select: { id: true } });
        if (reused) throw Errors.badRequest('INVALID_UPLOAD', 'Upload not found or not allowed here');
        uploadId = input.uploadId;
        // Order photos are checked by a moderator (admin panel, Phase 6).
        status = 'pending';
      }

      const visit = await tx.serviceVisit.create({
        data: { id: newId(), userId: viewer.id, serviceId, method: input.method, uploadId, distanceM, status },
      });
      if (status === 'verified') await recomputeServiceStats(tx, serviceId);
      return toVisitDto(visit);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
}
