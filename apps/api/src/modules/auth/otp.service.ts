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

const HOUR = 3600;
const PHONE_PER_HOUR = 5;
const IP_PER_HOUR = 20;
const FAILURES_PER_HOUR = 10;

export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** LIMITS.otpLength)).padStart(LIMITS.otpLength, '0');
}

/** Codes are stored as HMAC(OTP_SECRET, phone:code) so a DB leak doesn't reveal live codes. */
export function hashOtp(secret: string, phone: string, code: string): string {
  return createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex');
}

const failureRule = (phone: string): RateRule => ({ key: `otp:fail:${phone}`, limit: FAILURES_PER_HOUR, windowSec: HOUR });

@Injectable()
export class OtpService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly rateLimiter: RateLimiterService,
    private readonly sms: SmsSender,
  ) {}

  /** Issues a new code (invalidating older ones) and sends it by SMS. `phone` must be normalized E.164. */
  async request(phone: string, ip: string): Promise<OtpRequestResult> {
    await this.rateLimiter.checkOrThrow([failureRule(phone)]);
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
   * burned; repeated failures lock the phone out for an hour.
   */
  async verify(phone: string, code: string): Promise<void> {
    await this.rateLimiter.checkOrThrow([failureRule(phone)]);
    const now = new Date();
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, usedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.attempts >= LIMITS.otpMaxAttempts) throw codeExpired();

    // Claim the attempt atomically so parallel guesses can't exceed the per-code limit.
    const claimed = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, usedAt: null, attempts: { lt: LIMITS.otpMaxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (claimed.count === 0) throw codeExpired();

    if (!safeEqual(hashOtp(this.env.OTP_SECRET, phone, code), otp.codeHash)) {
      await this.rateLimiter.consume([failureRule(phone)]);
      const attemptsLeft = Math.max(0, LIMITS.otpMaxAttempts - otp.attempts - 1);
      throw Errors.badRequest('OTP_INVALID', 'Wrong code', { attemptsLeft });
    }
    const used = await this.prisma.otpCode.updateMany({ where: { id: otp.id, usedAt: null }, data: { usedAt: now } });
    if (used.count === 0) throw codeExpired();
  }
}

const codeExpired = () => Errors.badRequest('OTP_EXPIRED', 'Code expired or used up, request a new one');
