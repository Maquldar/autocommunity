import type { Vehicle } from '@prisma/client';
import type { VehicleDto } from '@autoc/shared';

/** Plate is private: only the owner and accepted friends see it (SPEC A-5). */
export function toVehicleDto(v: Vehicle, showPlate: boolean): VehicleDto {
  return {
    id: v.id,
    brand: v.brand,
    model: v.model,
    year: v.year,
    plate: showPlate ? v.plate : null,
    isPrimary: v.isPrimary,
  };
}
