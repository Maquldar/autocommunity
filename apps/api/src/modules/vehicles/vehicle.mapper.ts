import type { Upload, Vehicle } from '@prisma/client';
import type { OwnVehicleDto, UploadDto, VehicleDto } from '@autoc/shared';

/**
 * Plate is private: only the owner and accepted friends see it (SPEC A-5). The VIN is never part of a
 * VehicleDto; `toOwnVehicleDto` adds it for the owner's own list.
 */
export function toVehicleDto(v: Vehicle, showPlate: boolean, photos: UploadDto[]): VehicleDto {
  return {
    id: v.id,
    brand: v.brand,
    model: v.model,
    year: v.year,
    plate: showPlate ? v.plate : null,
    isPrimary: v.isPrimary,
    engineVolumeL: v.engineVolumeL === null ? null : Math.round(v.engineVolumeL * 10) / 10,
    fuel: v.fuel,
    transmission: v.transmission,
    drive: v.drive,
    bodyType: v.bodyType,
    color: v.color,
    mileageKm: v.mileageKm,
    description: v.description,
    photos,
  };
}

export function toOwnVehicleDto(v: Vehicle, photos: UploadDto[]): OwnVehicleDto {
  return { ...toVehicleDto(v, true, photos), vin: v.vin };
}

/** Photos in the vehicle's stored order (missing uploads are skipped). */
export function orderedPhotos(v: Pick<Vehicle, 'photoUploadIds'>, byId: Map<string, Upload>, toDto: (u: Upload) => UploadDto): UploadDto[] {
  return v.photoUploadIds.flatMap((id) => {
    const u = byId.get(id);
    return u ? [toDto(u)] : [];
  });
}
