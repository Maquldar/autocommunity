import { Inject, Injectable } from '@nestjs/common';
import { LIMITS, type OtpRequestResult } from '@autoc/shared';
import { createHmac, randomInt } from 'node:crypto';
import { ENV, isDevOtpExposed, type Env } from '../../config/env';
import { Errors } from '../../common/errors/api-exception';
import { safeEqual } from '../../common/http/auth-cookies';
import { newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RateLimiterService, type RateRule } from '../../infra/rate-limit/rate-limiter.service';
import { SmsSender } from '../../infra/sms/sms-sender';
import { AntifraudService } from '../antifraud/antifraud.service';

const HOUR = 3600;
const PHONE_PER_HOUR = 5;
const IP_PER_HOUR = 20;
/** Wrong codes per phone from one IP before that IP is locked out for the phone. */
const FAILURES_PER_PHONE_IP = 10;
/**
 * Backstop across all IPs. Keying the main lockout on phone+IP stops a third party from locking the real
 * owner out; this higher per-phone cap still bounds a distributed guessing attack.
 */
const FAILURES_PER_PHONE = 30;

export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** LIMITS.otpLength)).padStart(LIMITS.otpLength, '0');
}

/** Codes are stored as HMAC(OTP_SECRET, phone:code) so a DB leak doesn't reveal live codes. */
export function hashOtp(secret: string, phone: string, code: string): string {
  return createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex');
}

export const failureRules = (phone: string, ip: string): RateRule[] => [
  { key: `otp:fail:${phone}:${ip}`, limit: FAILURES_PER_PHONE_IP, windowSec: HOUR },
  { key: `otp:fail:${phone}`, limit: FAILURES_PER_PHONE, windowSec: HOUR },
];

type ClaimedCode = { id: string; codeHash: string; attempts: number };

@Injectable()
export class OtpService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly rateLimiter: RateLimiterService,
    private readonly sms: SmsSender,
    private readonly antifraud: AntifraudService,
  ) {}

  /** Throws PHONE_NOT_SUPPORTED for numbers outside OTP_ALLOWED_PREFIXES (SMS toll-fraud protection). */
  assertSupported(phone: string): void {
    if (!this.env.OTP_ALLOWED_PREFIXES.some((p) => phone.startsWith(p))) {
      throw Errors.badRequest('PHONE_NOT_SUPPORTED', 'Phone numbers from this country are not supported yet');
    }
  }

  /** Issues a new code (invalidating older ones) and sends it by SMS. `phone` must be normalized E.164. */
  async request(phone: string, ip: string): Promise<OtpRequestResult> {
    this.assertSupported(phone);
    await this.rateLimiter.checkOrThrow(failureRules(phone, ip));
    await this.rateLimiter.consumeOrThrow([
      { key: `otp:phone:cooldown:${phone}`, limit: 1, windowSec: LIMITS.otpResendSec },
      { key: `otp:phone:hour:${phone}`, limit: PHONE_PER_HOUR, windowSec: HOUR },
      { key: `otp:ip:${ip}`, limit: IP_PER_HOUR, windowSec: HOUR },
      { key: 'otp:global', limit: this.env.OTP_GLOBAL_PER_HOUR, windowSec: HOUR },
    ]);

    const code = generateOtpCode();
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.otpCode.updateMany({ where: { phone, usedAt: null }, data: { usedAt: now } }),
      this.prisma.otpCode.deleteMany({ where: { phone, createdAt: { lt: new Date(now.getTime() - 24 * HOUR * 1000) } } }),
      this.prisma.otpCode.create({
        data: {
          id: newId(),
          phone,
          codeHash: hashOtp(this.env.OTP_SECRET, phone, code),
          expiresAt: new Date(now.getTime() + LIMITS.otpTtlSec * 1000),
        },
      }),
    ]);
    await this.sms.send(phone, `AutoCommunity code: ${code}. Do not share it with anyone.`);

    return isDevOtpExposed(this.env) ? { retryAfterSec: LIMITS.otpResendSec, devCode: code } : { retryAfterSec: LIMITS.otpResendSec };
  }

  /**
   * Consumes the latest active code for the phone. Each code allows `otpMaxAttempts` tries, then it is
   * burned. A failure slot is reserved before comparing (so parallel guesses can't exceed the lockout)
   * and refunded when the attempt turns out not to be a wrong guess.
   */
  async verify(phone: string, code: string, ip: string): Promise<void> {
    const failureSlot = await this.rateLimiter.reserveOrThrow(failureRules(phone, ip));
    const otp = await this.claimAttempt(phone);
    if (!otp) {
      await this.rateLimiter.refund(failureSlot);
      throw codeExpired();
    }
    if (!safeEqual(hashOtp(this.env.OTP_SECRET, phone, code), otp.codeHash)) {
      // This wrong guess may have used up a failure rule: that's a lockout (antifraud otp_abuse).
      const after = await this.rateLimiter.check(failureRules(phone, ip));
      if (!after.allowed) this.antifraud.otpLockout(phone, ip, after.retryAfterSec);
      throw Errors.badRequest('OTP_INVALID', 'Wrong code', { attemptsLeft: Math.max(0, LIMITS.otpMaxAttempts - otp.attempts) });
    }
    await this.rateLimiter.refund(failureSlot);
    const used = await this.prisma.otpCode.updateMany({ where: { id: otp.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count === 0) throw codeExpired();
  }

  /** Atomically counts an attempt on the newest live code; returns the post-increment attempt count. */
  private async claimAttempt(phone: string): Promise<ClaimedCode | null> {
    const rows = await this.prisma.$queryRaw<ClaimedCode[]>`
      UPDATE otp_codes SET attempts = attempts + 1
      WHERE id = (
        SELECT id FROM otp_codes
        WHERE phone = ${phone} AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1
      )
      AND attempts < ${LIMITS.otpMaxAttempts}
      RETURNING id, code_hash AS "codeHash", attempts`;
    return rows[0] ?? null;
  }
}

const codeExpired = () => Errors.badRequest('OTP_EXPIRED', 'Code expired or used up, request a new one');
