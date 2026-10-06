import type { VehicleDto } from '@autoc/shared';

export type VehicleFact =
  | { key: 'plate'; kind: 'text'; value: string }
  | { key: 'engineVolume'; kind: 'engine'; value: number }
  | { key: 'mileage'; kind: 'mileage'; value: number }
  | { key: 'fuel' | 'transmission' | 'drive' | 'bodyType' | 'color'; kind: 'enum'; value: string };

/**
 * The details a vehicle page lists, in a fixed order, leaving out what isn't set. The plate is only there
 * when the API returned it (owner and friends); the VIN is never part of a public vehicle.
 */
export function vehicleFacts(v: Partial<Pick<VehicleDto, 'plate' | 'engineVolumeL' | 'fuel' | 'transmission' | 'drive' | 'bodyType' | 'color' | 'mileageKm'>>): VehicleFact[] {
  const out: VehicleFact[] = [];
  if (v.plate) out.push({ key: 'plate', kind: 'text', value: v.plate });
  if (typeof v.engineVolumeL === 'number') out.push({ key: 'engineVolume', kind: 'engine', value: v.engineVolumeL });
  for (const key of ['fuel', 'transmission', 'drive', 'bodyType', 'color'] as const) {
    const value = v[key];
    if (typeof value === 'string' && value) out.push({ key, kind: 'enum', value });
  }
  if (typeof v.mileageKm === 'number') out.push({ key: 'mileage', kind: 'mileage', value: v.mileageKm });
  return out;
}
