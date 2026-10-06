import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { sosGuidance } from './guidance';

const err = (code: string, status = 409, details?: unknown) => new ApiError({ status, code, message: code, details });

describe('sosGuidance', () => {
  it('maps every create gate to guidance with the next step', () => {
    expect(sosGuidance(err('PHONE_NOT_VERIFIED', 403), 'create')).toMatchObject({
      key: 'phoneNotVerified',
      action: { kind: 'link', href: '/settings#settings-phone' },
    });
    expect(sosGuidance(err('RATING_TOO_LOW', 403), 'create')).toMatchObject({ key: 'ratingTooLowCreate', values: { min: 20 } });
    expect(sosGuidance(err('RATING_TOO_LOW', 403), 'help')).toMatchObject({ key: 'ratingTooLowHelp', values: { min: 30 } });
    const banned = sosGuidance(err('SOS_BANNED', 403, { until: '2026-10-07T10:00:00.000Z' }), 'create');
    expect(banned?.key).toBe('banned');
    expect(banned?.values?.until?.toISOString()).toBe('2026-10-07T10:00:00.000Z');
    expect(sosGuidance(err('SOS_BANNED', 403, { until: '2026-10-07T10:00:00.000Z' }), 'help')?.key).toBe('bannedHelp');
    const limited = sosGuidance(err('SOS_RATE_LIMIT', 429, { retryAfterSec: 600 }), 'create', 1_000_000);
    expect(limited).toMatchObject({ key: 'rateLimit' });
    expect(limited?.values?.retryAt?.getTime()).toBe(1_000_000 + 600_000);
    expect(sosGuidance(err('SOS_ALREADY_OPEN'), 'create')).toMatchObject({ key: 'alreadyOpen', action: { kind: 'open_active' } });
    expect(sosGuidance(err('LOCATION_REQUIRED'), 'nearby')).toMatchObject({ key: 'locationRequired', action: { kind: 'share_location' } });
  });

  it('maps helper conflicts', () => {
    expect(sosGuidance(err('SOS_HELPER_LIMIT'), 'requester')?.key).toBe('helperLimit');
    expect(sosGuidance(err('SOS_HELPER_BUSY'), 'help')?.key).toBe('helperBusy');
    expect(sosGuidance(err('SOS_OFFER_LIMIT'), 'help')).toMatchObject({ key: 'offerLimit', action: { href: '/sos/nearby' } });
    expect(sosGuidance(err('SOS_INVALID_STATE'), 'help')).toMatchObject({ key: 'invalidState', action: { kind: 'reload' } });
    expect(sosGuidance(err('NOT_FOUND', 404), 'help')?.key).toBe('notFound');
  });

  it('returns null for generic errors', () => {
    expect(sosGuidance(err('NOT_FOUND', 404), 'create')).toBeNull();
    expect(sosGuidance(err('INTERNAL', 500), 'create')).toBeNull();
    expect(sosGuidance(new Error('x'), 'create')).toBeNull();
    expect(sosGuidance(err('SOS_BANNED', 403, { until: 'garbage' }), 'create')?.values).toEqual({});
  });
});
