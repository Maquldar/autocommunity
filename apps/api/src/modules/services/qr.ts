import { createHmac, timingSafeEqual } from 'node:crypto';
import { almatyClock, base32, normalizeQrCode, SERVICE_LIMITS } from '@autoc/shared';

const DAY_MS = 86_400_000;

/** Day code printed at a service: base32(HMAC-SHA256(qr_secret, "YYYY-MM-DD" in Asia/Almaty)), 8 chars. */
export function serviceQrCode(secret: string, almatyDate: string): string {
  const mac = createHmac('sha256', secret).update(almatyDate).digest();
  return base32(mac, SERVICE_LIMITS.qrCodeLength);
}

/** Today's code (Almaty calendar day). */
export function currentQrCode(secret: string, now = new Date()): string {
  return serviceQrCode(secret, almatyClock(now).date);
}

/** A scanned/typed code is valid for today's or yesterday's Almaty date. */
export function isValidQrCode(secret: string, input: string, now = new Date()): boolean {
  const code = normalizeQrCode(input);
  if (code.length !== SERVICE_LIMITS.qrCodeLength) return false;
  const dates = [almatyClock(now).date, almatyClock(new Date(now.getTime() - DAY_MS)).date];
  const given = Buffer.from(code);
  // Check both days without short-circuiting so timing doesn't reveal which one matched.
  let ok = false;
  for (const date of dates) {
    const expected = Buffer.from(serviceQrCode(secret, date));
    if (expected.length === given.length && timingSafeEqual(expected, given)) ok = true;
  }
  return ok;
}
