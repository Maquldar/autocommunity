import { describe, expect, it } from 'vitest';
import { generateOtpCode, hashOtp } from './otp.service';

describe('OTP helpers', () => {
  it('generates 6-digit zero-padded codes', () => {
    for (let i = 0; i < 500; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });

  it('hashes with HMAC-SHA256 bound to the phone and secret', () => {
    const h = hashOtp('secret-a', '+77011234567', '123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOtp('secret-a', '+77011234567', '123456')).toBe(h);
    expect(hashOtp('secret-b', '+77011234567', '123456')).not.toBe(h);
    expect(hashOtp('secret-a', '+77011234568', '123456')).not.toBe(h);
    expect(hashOtp('secret-a', '+77011234567', '123457')).not.toBe(h);
    expect(h).not.toContain('123456');
  });
});
