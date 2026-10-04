import { Injectable } from '@nestjs/common';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { ACCESS_TOKEN_TTL_SEC } from './access-token.service';
import { sessionsRevokedKey } from './user-state.service';

/** Redis channel the realtime gateway listens on to disconnect a user's sockets. */
export const SESSION_REVOKED_CHANNEL = 'auth:session-revoked';

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Ends every session of a user: revokes refresh tokens, invalidates access tokens issued before now
   * (for their remaining lifetime) and notifies realtime connections.
   */
  async revokeAll(userId: string, tx: Tx = this.prisma): Promise<void> {
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.markRevoked(userId);
  }

  /** Redis-only part of revocation, for callers that already deleted tokens in their own transaction. */
  async markRevoked(userId: string): Promise<void> {
    await this.redis.set(sessionsRevokedKey(userId), String(Date.now()), 'EX', ACCESS_TOKEN_TTL_SEC + 60);
    await this.redis.publish(SESSION_REVOKED_CHANNEL, JSON.stringify({ userId }));
  }
}
