import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ADMIN_LIMITS } from '@autoc/shared';
import type { AuthedRequest } from '../../common/auth/decorators';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';

/** 300 admin API requests per minute per admin → 429 RATE_LIMITED. Runs after the global auth/role guards. */
@Injectable()
export class AdminRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimiter: RateLimiterService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) return true;
    await this.rateLimiter.consumeOrThrow([{ key: `admin:${user.id}`, limit: ADMIN_LIMITS.perMinute, windowSec: 60 }]);
    return true;
  }
}
