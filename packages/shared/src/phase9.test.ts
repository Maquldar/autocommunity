import { describe, expect, it } from 'vitest';
import { createPostSchema } from './feed';
import { vehicleBodySchema, updateVehicleBodySchema, vehicleSchema } from './schemas';
import { createViolationSchema, disputeViolationSchema } from './violations';
import { createVoteSchema, voteReasonFits } from './votes';
import { adminWalletAdjustSchema, createTopupSchema, createTransferSchema, demoConfirmTopupSchema, perkLimit, PREMIUM_PERK_LIMITS } from './wallet';

const uuid = '0192f0c0-0000-7000-8000-000000000001';
const ok = (r: { success: boolean }) => expect(r.success).toBe(true);
const bad = (r: { success: boolean }) => expect(r.success).toBe(false);

describe('wallet schemas', () => {
  it('top-up amount 500..200 000, integers only', () => {
    ok(createTopupSchema.safeParse({ amount: 500 }));
    ok(createTopupSchema.safeParse({ amount: 200_000 }));
    bad(createTopupSchema.safeParse({ amount: 499 }));
    bad(createTopupSchema.safeParse({ amount: 200_001 }));
    bad(createTopupSchema.safeParse({ amount: 1000.5 }));
    bad(createTopupSchema.safeParse({ amount: '1000' }));
  });

  it('demo card number is normalized; expiry and cvc are optional but checked', () => {
    expect(demoConfirmTopupSchema.parse({ cardNumber: '4242 4242 4242 4242' }).cardNumber).toBe('4242424242424242');
    expect(demoConfirmTopupSchema.parse({ cardNumber: '4000-0000-0000-0002' }).cardNumber).toBe('4000000000000002');
    bad(demoConfirmTopupSchema.safeParse({ cardNumber: '4242' }));
    bad(demoConfirmTopupSchema.safeParse({ cardNumber: '4242abcd42424242' }));
    ok(demoConfirmTopupSchema.safeParse({ cardNumber: '4242424242424242', expiry: '12/30', cvc: '123' }));
    bad(demoConfirmTopupSchema.safeParse({ cardNumber: '4242424242424242', expiry: '13/30' }));
  });

  it('transfer: exactly one recipient, 100..50 000, idempotency key required', () => {
    const base = { amount: 100, idempotencyKey: 'abcd-1234' };
    ok(createTransferSchema.safeParse({ ...base, toUserId: uuid }));
    expect(createTransferSchema.parse({ ...base, toNickname: 'Aidar_77' }).toNickname).toBe('aidar_77');
    bad(createTransferSchema.safeParse({ ...base }));
    bad(createTransferSchema.safeParse({ ...base, toUserId: uuid, toNickname: 'aidar' }));
    bad(createTransferSchema.safeParse({ ...base, toUserId: uuid, amount: 99 }));
    bad(createTransferSchema.safeParse({ ...base, toUserId: uuid, amount: 50_001 }));
    bad(createTransferSchema.safeParse({ amount: 100, toUserId: uuid }));
    bad(createTransferSchema.safeParse({ ...base, toUserId: uuid, idempotencyKey: 'short' }));
    bad(createTransferSchema.safeParse({ ...base, toUserId: uuid, message: 'a'.repeat(141) }));
    expect(createTransferSchema.parse({ ...base, toUserId: uuid, message: '  ' }).message).toBeUndefined();
  });

  it('admin adjust: non-zero integer with a note', () => {
    ok(adminWalletAdjustSchema.safeParse({ amount: -500, note: 'refund fix' }));
    bad(adminWalletAdjustSchema.safeParse({ amount: 0, note: 'nothing' }));
    bad(adminWalletAdjustSchema.safeParse({ amount: 10 }));
  });

  it('premium doubles the existing limits', () => {
    expect(PREMIUM_PERK_LIMITS).toEqual({
      vehicles: { base: 5, premium: 10 },
      postMedia: { base: 6, premium: 12 },
      communitiesOwned: { base: 10, premium: 20 },
      communityMemberships: { base: 50, premium: 100 },
    });
    expect(perkLimit('vehicles', true)).toBe(10);
    expect(perkLimit('vehicles', false)).toBe(5);
    // the post schema accepts the premium maximum; the server enforces the base one for others
    ok(createPostSchema.safeParse({ mediaUploadIds: Array.from({ length: 12 }, (_, i) => `0192f0c0-0000-7000-8000-0000000000${String(i).padStart(2, '0')}`) }));
  });
});

describe('vote schema', () => {
  it('value ±1 with a matching reason, comment ≤ 200', () => {
    ok(createVoteSchema.safeParse({ value: 1, reason: 'helped_on_road' }));
    ok(createVoteSchema.safeParse({ value: -1, reason: 'dangerous_driving', comment: 'Подрезал на Аль-Фараби' }));
    ok(createVoteSchema.safeParse({ value: -1, reason: 'other' }));
    bad(createVoteSchema.safeParse({ value: 1, reason: 'scam' }));
    bad(createVoteSchema.safeParse({ value: -1, reason: 'polite' }));
    bad(createVoteSchema.safeParse({ value: 2, reason: 'polite' }));
    bad(createVoteSchema.safeParse({ value: 1, reason: 'polite', comment: 'x'.repeat(201) }));
    expect(voteReasonFits(1, 'other')).toBe(true);
  });
});

describe('violation schemas', () => {
  const base = { category: 'speeding', codeType: 'koap', occurredAt: new Date(Date.now() - 3600_000).toISOString(), description: 'Ехал 120 в городе', photoUploadIds: [uuid] };

  it('needs 1–3 distinct photos and a 10..1000 description; article is optional free text', () => {
    ok(createViolationSchema.safeParse(base));
    ok(createViolationSchema.safeParse({ ...base, article: 'ст. 592 КоАП' }));
    bad(createViolationSchema.safeParse({ ...base, photoUploadIds: [] }));
    bad(createViolationSchema.safeParse({ ...base, photoUploadIds: [uuid, uuid] }));
    bad(createViolationSchema.safeParse({ ...base, description: 'short' }));
    bad(createViolationSchema.safeParse({ ...base, category: 'jaywalking' }));
    bad(createViolationSchema.safeParse({ ...base, codeType: 'gk' }));
    bad(createViolationSchema.safeParse({ ...base, article: 'x'.repeat(61) }));
  });

  it('occurredAt is not in the future and not older than 3 years', () => {
    bad(createViolationSchema.safeParse({ ...base, occurredAt: new Date(Date.now() + 86_400_000).toISOString() }));
    bad(createViolationSchema.safeParse({ ...base, occurredAt: new Date(Date.now() - 4 * 365 * 86_400_000).toISOString() }));
  });

  it('dispute text 10..1000', () => {
    ok(disputeViolationSchema.safeParse({ text: 'Это был не я, машина продана' }));
    bad(disputeViolationSchema.safeParse({ text: 'нет' }));
  });
});

describe('vehicle details', () => {
  const v = { brand: 'Toyota', model: 'Camry', year: 2020 };

  it('VIN: 17 chars without I/O/Q, upper-cased', () => {
    expect(vehicleBodySchema.parse({ ...v, vin: 'jtnb11hk5j3000001' }).vin).toBe('JTNB11HK5J3000001');
    bad(vehicleBodySchema.safeParse({ ...v, vin: 'JTNB11HK5J300000' }));
    bad(vehicleBodySchema.safeParse({ ...v, vin: 'JTNB11HK5J30000O1' }));
    bad(vehicleBodySchema.safeParse({ ...v, vin: 'ITNB11HK5J3000001' }));
    bad(vehicleBodySchema.safeParse({ ...v, vin: 'QTNB11HK5J3000001' }));
  });

  it('engine 0.6–8.0 L (one decimal), enums, mileage, description, ≤ 5 photos', () => {
    expect(vehicleBodySchema.parse({ ...v, engineVolumeL: 2.45 }).engineVolumeL).toBe(2.5);
    bad(vehicleBodySchema.safeParse({ ...v, engineVolumeL: 0.5 }));
    bad(vehicleBodySchema.safeParse({ ...v, engineVolumeL: 8.1 }));
    bad(vehicleBodySchema.safeParse({ ...v, engineVolumeL: '2.0' }));
    expect(vehicleSchema.parse({ ...v, engineVolumeL: '2.0' }).engineVolumeL).toBe(2);
    ok(vehicleBodySchema.safeParse({ ...v, fuel: 'hybrid', transmission: 'cvt', drive: 'awd', bodyType: 'crossover', mileageKm: 120_000 }));
    bad(vehicleBodySchema.safeParse({ ...v, fuel: 'hydrogen' }));
    bad(vehicleBodySchema.safeParse({ ...v, mileageKm: -1 }));
    bad(vehicleBodySchema.safeParse({ ...v, description: 'x'.repeat(501) }));
    bad(vehicleBodySchema.safeParse({ ...v, photoUploadIds: Array(6).fill(uuid) }));
    expect(updateVehicleBodySchema.parse({ fuel: null, description: '' })).toEqual({ fuel: null, description: null });
  });
});
