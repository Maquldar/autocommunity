import { Injectable } from '@nestjs/common';
import type { Upload, Vehicle } from '@prisma/client';
import type { OwnVehicleDto, UploadDto, VehicleDto, VehicleInput } from '@autoc/shared';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { perkConflict, userPerkLimit } from '../../common/premium';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { Storage } from '../../infra/storage/storage';
import { toUploadDto } from '../uploads/upload.mapper';
import { UploadsService } from '../uploads/uploads.service';
import { orderedPhotos, toOwnVehicleDto, toVehicleDto } from './vehicle.mapper';

const listOrder = [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }];

const invalidUpload = (message = 'Upload not found or not allowed here') => Errors.badRequest('INVALID_UPLOAD', message);

/** The detail columns of a create/update body (undefined = unchanged; null clears). */
function detailData(input: Partial<VehicleInput>) {
  return {
    vin: input.vin,
    engineVolumeL: input.engineVolumeL,
    fuel: input.fuel,
    transmission: input.transmission,
    drive: input.drive,
    bodyType: input.bodyType,
    color: input.color,
    mileageKm: input.mileageKm,
    description: input.description,
  };
}

/**
 * Invariant: a user with vehicles has exactly one primary. All writes lock the owner's row first so
 * concurrent requests can't break the invariant or exceed the per-user limit (5, premium 10).
 */
@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
    private readonly uploads: UploadsService,
  ) {}

  /** Public list (no VIN); the plate only when `showPlate`. */
  async list(ownerId: string, showPlate: boolean): Promise<VehicleDto[]> {
    const rows = await this.prisma.vehicle.findMany({ where: { userId: ownerId }, orderBy: listOrder });
    const photos = await this.photosFor(rows);
    return rows.map((v) => toVehicleDto(v, showPlate, photos(v)));
  }

  /** The owner's own list, with the VIN. */
  async listOwn(ownerId: string): Promise<OwnVehicleDto[]> {
    const rows = await this.prisma.vehicle.findMany({ where: { userId: ownerId }, orderBy: listOrder });
    const photos = await this.photosFor(rows);
    return rows.map((v) => toOwnVehicleDto(v, photos(v)));
  }

  /** One vehicle rendered for a viewer (no VIN). */
  async render(v: Vehicle, showPlate: boolean): Promise<VehicleDto> {
    const photos = await this.photosFor([v]);
    return toVehicleDto(v, showPlate, photos(v));
  }

  async create(userId: string, input: VehicleInput): Promise<OwnVehicleDto> {
    const photoIds = input.photoUploadIds ?? [];
    const v = await this.prisma.$transaction(async (tx) => {
      await lockOwner(tx, userId);
      const count = await tx.vehicle.count({ where: { userId } });
      const limit = await userPerkLimit(tx, userId, 'vehicles');
      if (count >= limit) throw perkConflict('VEHICLE_LIMIT', `You can add up to ${limit} vehicles`, 'vehicles', limit);
      if (photoIds.length) await this.assertPhotos(tx, userId, photoIds, null);
      const isPrimary = count === 0 || input.isPrimary === true;
      if (isPrimary) await tx.vehicle.updateMany({ where: { userId, isPrimary: true }, data: { isPrimary: false } });
      return tx.vehicle.create({
        data: {
          id: newId(),
          userId,
          brand: input.brand,
          model: input.model,
          year: input.year,
          plate: input.plate ?? null,
          isPrimary,
          ...detailData(input),
          photoUploadIds: photoIds,
          coverUploadId: photoIds[0] ?? null,
        },
      });
    });
    return this.renderOwn(v);
  }

  async update(userId: string, vehicleId: string, input: Partial<VehicleInput>): Promise<OwnVehicleDto> {
    const { v, removedPhotos } = await this.prisma.$transaction(async (tx) => {
      await lockOwner(tx, userId);
      const current = await requireOwned(tx, userId, vehicleId);
      let isPrimary = current.isPrimary;

      if (input.isPrimary === true && !current.isPrimary) {
        await tx.vehicle.updateMany({ where: { userId, isPrimary: true }, data: { isPrimary: false } });
        isPrimary = true;
      } else if (input.isPrimary === false && current.isPrimary) {
        // Un-marking the primary hands the role to the oldest other vehicle; a lone vehicle stays primary.
        const next = await oldestOther(tx, userId, vehicleId);
        if (next) {
          await tx.vehicle.update({ where: { id: vehicleId }, data: { isPrimary: false } });
          await tx.vehicle.update({ where: { id: next.id }, data: { isPrimary: true } });
          isPrimary = false;
        }
      }

      const photoIds = input.photoUploadIds;
      if (photoIds?.length) await this.assertPhotos(tx, userId, photoIds, vehicleId);
      const removed = photoIds ? current.photoUploadIds.filter((id) => !photoIds.includes(id)) : [];

      const v = await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          brand: input.brand,
          model: input.model,
          year: input.year,
          plate: input.plate === undefined ? undefined : input.plate,
          isPrimary,
          ...detailData(input),
          ...(photoIds ? { photoUploadIds: photoIds, coverUploadId: photoIds[0] ?? null } : {}),
        },
      });
      return { v, removedPhotos: removed };
    });
    for (const id of removedPhotos) await this.uploads.remove(id);
    return this.renderOwn(v);
  }

  async remove(userId: string, vehicleId: string): Promise<void> {
    const photos = await this.prisma.$transaction(async (tx) => {
      await lockOwner(tx, userId);
      const current = await requireOwned(tx, userId, vehicleId);
      await tx.vehicle.delete({ where: { id: vehicleId } });
      if (current.isPrimary) {
        const next = await oldestOther(tx, userId, vehicleId);
        if (next) await tx.vehicle.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
      return current.photoUploadIds;
    });
    for (const id of photos) await this.uploads.remove(id);
  }

  private async renderOwn(v: Vehicle): Promise<OwnVehicleDto> {
    const photos = await this.photosFor([v]);
    return toOwnVehicleDto(v, photos(v));
  }

  /** One upload query for the photos of many vehicles. */
  private async photosFor(rows: Vehicle[]): Promise<(v: Vehicle) => UploadDto[]> {
    const ids = [...new Set(rows.flatMap((r) => r.photoUploadIds))];
    const uploads: Upload[] = ids.length ? await this.prisma.upload.findMany({ where: { id: { in: ids } } }) : [];
    const byId = new Map(uploads.map((u) => [u.id, u]));
    return (v) => orderedPhotos(v, byId, (u) => toUploadDto(u, this.storage));
  }

  /** The caller's own `vehicle` uploads, not attached to another vehicle (the owner row is locked). */
  private async assertPhotos(tx: Tx, userId: string, ids: string[], vehicleId: string | null): Promise<void> {
    const own = await tx.upload.count({ where: { id: { in: ids }, ownerId: userId, purpose: 'vehicle' } });
    if (own !== ids.length) throw invalidUpload('Photos must be your own uploads with purpose "vehicle"');
    const [used] = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM vehicles WHERE photo_upload_ids && ${ids}::uuid[] AND id IS DISTINCT FROM ${vehicleId}::uuid`;
    if (used && used.n > 0) throw invalidUpload('This upload is already used elsewhere');
  }
}

async function lockOwner(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
}

async function requireOwned(tx: Tx, userId: string, vehicleId: string) {
  const v = await tx.vehicle.findFirst({ where: { id: vehicleId, userId } });
  if (!v) throw Errors.notFound('Vehicle not found');
  return v;
}

function oldestOther(tx: Tx, userId: string, excludeId: string) {
  return tx.vehicle.findFirst({
    where: { userId, id: { not: excludeId } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
}
