import { Injectable } from '@nestjs/common';
import type { UserRole } from '@autoc/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';

export type UserState = { status: 'active' | 'blocked' | 'deleted'; role: UserRole; blockedUntil: string | null };

const STATE_TTL_SEC = 60;
const stateKey = (userId: string) => `user:state:${userId}`;
export const sessionsRevokedKey = (userId: string) => `auth:revoked-before:${userId}`;

export function isUserBlocked(state: Pick<UserState, 'status' | 'blockedUntil'>, now = Date.now()): boolean {
  if (state.status === 'deleted') return true;
  if (state.status !== 'blocked') return false;
  return !state.blockedUntil || new Date(state.blockedUntil).getTime() > now;
}

/**
 * Account status/role cached in Redis for ~60 s so every authenticated request can reject blocked users
 * without a DB hit. Call `invalidate` after changing status or role.
 */
@Injectable()
export class UserStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** State plus the "sessions revoked before" timestamp (ms) in one round trip. */
  async getForAuth(userId: string): Promise<{ state: UserState | null; revokedBeforeMs: number | null }> {
    const [cached, revokedBefore] = await this.redis.mget(stateKey(userId), sessionsRevokedKey(userId));
    const state = cached ? (JSON.parse(cached) as UserState) : await this.load(userId);
    return { state, revokedBeforeMs: revokedBefore ? Number(revokedBefore) : null };
  }

  async get(userId: string): Promise<UserState | null> {
    const cached = await this.redis.get(stateKey(userId));
    return cached ? (JSON.parse(cached) as UserState) : this.load(userId);
  }

  async invalidate(userId: string): Promise<void> {
    await this.redis.del(stateKey(userId));
  }

  private async load(userId: string): Promise<UserState | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, role: true, blockedUntil: true },
    });
    if (!user) return null;
    const state: UserState = { status: user.status, role: user.role, blockedUntil: user.blockedUntil?.toISOString() ?? null };
    await this.redis.set(stateKey(userId), JSON.stringify(state), 'EX', STATE_TTL_SEC);
    return state;
  }
}
