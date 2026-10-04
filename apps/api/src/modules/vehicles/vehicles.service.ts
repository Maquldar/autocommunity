import { Injectable } from '@nestjs/common';
import { LIMITS, type VehicleDto, type VehicleInput } from '@autoc/shared';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { toVehicleDto } from './vehicle.mapper';

const listOrder = [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }];

/**
 * Invariant: a user with vehicles has exactly one primary. All writes lock the owner's row first so
 * concurrent requests can't break the invariant or exceed the per-user limit.
 */
@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string, showPlate: boolean): Promise<VehicleDto[]> {
    const rows = await this.prisma.vehicle.findMany({ where: { userId: ownerId }, orderBy: listOrder });
    return rows.map((v) => toVehicleDto(v, showPlate));
  }

  create(userId: string, input: VehicleInput): Promise<VehicleDto> {
    return this.prisma.$transaction(async (tx) => {
      await lockOwner(tx, userId);
      const count = await tx.vehicle.count({ where: { userId } });
      if (count >= LIMITS.vehiclesPerUser) {
        throw Errors.conflict('VEHICLE_LIMIT', `You can add up to ${LIMITS.vehiclesPerUser} vehicles`);
      }
      const isPrimary = count === 0 || input.isPrimary === true;
      if (isPrimary) await tx.vehicle.updateMany({ where: { userId, isPrimary: true }, data: { isPrimary: false } });
      const v = await tx.vehicle.create({
        data: {
          id: newId(),
          userId,
          brand: input.brand,
          model: input.model,
          year: input.year,
          plate: input.plate ?? null,
          isPrimary,
        },
      });
      return toVehicleDto(v, true);
    });
  }

  update(userId: string, vehicleId: string, input: Partial<VehicleInput>): Promise<VehicleDto> {
    return this.prisma.$transaction(async (tx) => {
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

      const v = await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          brand: input.brand,
          model: input.model,
          year: input.year,
          plate: input.plate === undefined ? undefined : input.plate,
          isPrimary,
        },
      });
      return toVehicleDto(v, true);
    });
  }

  remove(userId: string, vehicleId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      await lockOwner(tx, userId);
      const current = await requireOwned(tx, userId, vehicleId);
      await tx.vehicle.delete({ where: { id: vehicleId } });
      if (current.isPrimary) {
        const next = await oldestOther(tx, userId, vehicleId);
        if (next) await tx.vehicle.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    });
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
