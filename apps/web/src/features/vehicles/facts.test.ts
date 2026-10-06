import { describe, expect, it } from 'vitest';
import { vehicleBody } from '@/features/profile/vehicle-dialog';
import { vehicleDefaults, vinProblem } from '@/features/profile/vehicle-form';
import { vehicleFacts } from './facts';

describe('vehicle details', () => {
  it('lists set facts in a fixed order, never the VIN', () => {
    const facts = vehicleFacts({ plate: '123ABC02', engineVolumeL: 2.5, fuel: 'petrol', transmission: null, drive: 'awd', bodyType: 'suv', color: 'white', mileageKm: 85000, vin: 'X' } as never);
    expect(facts.map((f) => f.key)).toEqual(['plate', 'engineVolume', 'fuel', 'drive', 'bodyType', 'color', 'mileage']);
    expect(vehicleFacts({})).toEqual([]);
  });
  it('validates the VIN like the contract (17 chars, no I/O/Q)', () => {
    expect(vinProblem('')).toBeNull();
    expect(vinProblem('jtdbr32e720123456')).toBeNull();
    expect(vinProblem('JTDBR32E72012345')).toBe('length');
    expect(vinProblem('JTDBR32E72O123456')).toBe('letters');
    expect(vinProblem('JTDBR32E72-123456')).toBe('length');
  });
  it('fills the form from an own vehicle (missing color tolerated)', () => {
    const v = { brand: 'Toyota', model: 'Camry', year: 2019, plate: null, vin: 'JTDBR32E720123456', engineVolumeL: 2.5, fuel: 'petrol' as const, transmission: null, drive: null, bodyType: null, mileageKm: 1000, description: null };
    expect(vehicleDefaults(v)).toMatchObject({ year: '2019', plate: '', vin: 'JTDBR32E720123456', engineVolumeL: 2.5, color: null, description: '' });
  });
  it('builds request bodies: create drops unset details, update sends null to clear', () => {
    const values = { brand: 'Toyota', model: 'Camry', year: 2019, plate: null, vin: null, engineVolumeL: 2.5, fuel: null, description: null, photoUploadIds: undefined };
    expect(vehicleBody(values as never, ['p1'], 'create')).toEqual({ brand: 'Toyota', model: 'Camry', year: 2019, engineVolumeL: 2.5, photoUploadIds: ['p1'] });
    expect(vehicleBody(values as never, undefined, 'update')).toEqual({ brand: 'Toyota', model: 'Camry', year: 2019, plate: null, vin: null, engineVolumeL: 2.5, fuel: null, description: null });
  });
});
