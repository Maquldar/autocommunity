import { bayesianServiceRating } from '@autoc/shared';
import { describe, expect, it } from 'vitest';
import { currentQrCode, isValidQrCode, serviceQrCode } from './qr';
import { decodeServiceCursor, encodeServiceCursor } from './service-cursor';
import { similarNames } from './services.service';

const ID = '01900000-0000-7000-8000-000000000001';

describe('service QR codes', () => {
  const secret = 'a'.repeat(64);

  it('is a stable 8-char base32 HMAC of the Almaty date', () => {
    const code = serviceQrCode(secret, '2026-10-05');
    expect(code).toMatch(/^[A-Z2-7]{8}$/);
    expect(serviceQrCode(secret, '2026-10-05')).toBe(code);
    expect(serviceQrCode(secret, '2026-10-06')).not.toBe(code);
    expect(serviceQrCode('b'.repeat(64), '2026-10-05')).not.toBe(code);
  });

  it('accepts today and yesterday in Almaty, not the day before', () => {
    // 2026-10-05 00:30 in Almaty is still 2026-10-04 in UTC.
    const now = new Date('2026-10-04T19:30:00Z');
    expect(currentQrCode(secret, now)).toBe(serviceQrCode(secret, '2026-10-05'));
    expect(isValidQrCode(secret, serviceQrCode(secret, '2026-10-05'), now)).toBe(true);
    expect(isValidQrCode(secret, serviceQrCode(secret, '2026-10-04').toLowerCase(), now)).toBe(true);
    expect(isValidQrCode(secret, serviceQrCode(secret, '2026-10-03'), now)).toBe(false);
    expect(isValidQrCode(secret, 'nope', now)).toBe(false);
  });
});

describe('service cursors', () => {
  it('round-trips both sorts and refuses the other kind', () => {
    const d = encodeServiceCursor({ sort: 'distance', distance: 123.456789, id: ID });
    expect(decodeServiceCursor(d, 'distance')).toEqual({ sort: 'distance', distance: 123.456789, id: ID });
    const r = encodeServiceCursor({ sort: 'rating', rating: 4.2, reviewCount: 7, id: ID });
    expect(decodeServiceCursor(r, 'rating')).toEqual({ sort: 'rating', rating: 4.2, reviewCount: 7, id: ID });
    expect(() => decodeServiceCursor(d, 'rating')).toThrow();
    expect(() => decodeServiceCursor('%%%', 'rating')).toThrow();
    expect(decodeServiceCursor(undefined, 'rating')).toBeNull();
  });
});

describe('duplicate name check', () => {
  it('ignores case, spacing and punctuation; containment needs 4+ chars', () => {
    expect(similarNames('СТО «Мотор»', 'сто мотор')).toBe(true);
    expect(similarNames('Мотор', 'Автосервис Мотор Плюс')).toBe(true);
    expect(similarNames('Мойка', 'Шиномонтаж')).toBe(false);
    expect(similarNames('АБВ', 'АБВГД сервис')).toBe(false);
    expect(similarNames('!!!', '???')).toBe(false);
  });
});

describe('Bayesian service rating', () => {
  it('uses prior 3.5 with weight 5 and rounds to one decimal', () => {
    expect(bayesianServiceRating(0, 0)).toBe(3.5);
    expect(bayesianServiceRating(25, 5)).toBe(4.3); // (17.5 + 25) / 10 = 4.25 → 4.3
    expect(bayesianServiceRating(5, 5)).toBe(2.3); // 22.5 / 10 = 2.25 → 2.3
  });
});
