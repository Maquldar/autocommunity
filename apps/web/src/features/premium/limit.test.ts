import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { premiumLimitInfo } from './limit';

const err = (code: string, details?: unknown) => new ApiError({ status: 409, code, message: code, details });

describe('premiumLimitInfo', () => {
  it.each(['VEHICLE_LIMIT', 'MEDIA_LIMIT', 'COMMUNITY_LIMIT', 'MEMBERSHIP_LIMIT'])('%s with premiumLimit → hint', (code) => {
    expect(premiumLimitInfo(err(code, { limit: 5, premiumLimit: 10 }))).toEqual({ code, limit: 5, premiumLimit: 10 });
  });
  it('no hint without details, for premium users already at the premium limit, or other errors', () => {
    expect(premiumLimitInfo(err('VEHICLE_LIMIT'))).toBeNull();
    expect(premiumLimitInfo(err('VEHICLE_LIMIT', { limit: 10, premiumLimit: 10 }))).toBeNull();
    expect(premiumLimitInfo(err('RATE_LIMITED', { limit: 5, premiumLimit: 10 }))).toBeNull();
    expect(premiumLimitInfo(new Error('x'))).toBeNull();
  });
});
