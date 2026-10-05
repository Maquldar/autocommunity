import { applyDecorators, CanActivate, ExecutionContext, HttpStatus, Injectable, UseGuards } from '@nestjs/common';
import { ApiException } from '../errors/api-exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuthedRequest } from './decorators';

/**
 * 403 ONBOARDING_INCOMPLETE (details `{ missing }`) unless the caller completed onboarding. Used on every
 * action towards other people (communities, chats, SOS, friend requests, reports). Runs after JwtAuthGuard.
 */
@Injectable()
export class OnboardedGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) return true; // public route: nothing to check
    const u = await this.prisma.user.findUnique({ where: { id: user.id }, select: { onboardedAt: true, name: true, nickname: true } });
    if (u?.onboardedAt) return true;
    const missing = [!u?.name.trim() && 'name', !u?.nickname && 'nickname'].filter(Boolean);
    throw new ApiException(HttpStatus.FORBIDDEN, 'ONBOARDING_INCOMPLETE', 'Complete your profile first', { missing });
  }
}

export const RequireOnboarded = () => applyDecorators(UseGuards(OnboardedGuard));
