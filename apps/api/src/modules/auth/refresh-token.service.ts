import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Errors } from '../../common/errors/api-exception';
import { REFRESH_TTL_MS } from '../../common/http/auth-cookies';
import { newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';

export type ClientMeta = { ip: string | null; userAgent: string | null };

export const hashRefreshToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const invalidSession = () => Errors.unauthorized('Session expired, sign in again', 'SESSION_EXPIRED');

/**
 * Opaque refresh tokens (32 random bytes), stored only as SHA-256. Every refresh rotates the token
 * within its family; presenting an already-rotated token revokes the whole family (theft detection).
 */
@Injectable()
export class RefreshTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(userId: string, meta: ClientMeta, familyId: string = newId()): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
    await this.prisma.refreshToken.create({ data: this.row(userId, familyId, token, meta) });
    return token;
  }

  /** Returns the owner and a new token; throws 401 for unknown, expired or reused tokens. */
  async rotate(token: string, meta: ClientMeta): Promise<{ userId: string; token: string }> {
    const current = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(token) } });
    if (!current) throw invalidSession();
    if (current.revokedAt) {
      await this.revokeFamily(current.familyId);
      throw invalidSession();
    }
    if (current.expiresAt <= new Date()) throw invalidSession();

    const next = randomBytes(32).toString('base64url');
    const nextRow = this.row(current.userId, current.familyId, next, meta);
    const rotated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshToken.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedBy: nextRow.id },
      });
      if (claimed.count === 0) return false;
      await tx.refreshToken.create({ data: nextRow });
      return true;
    });
    if (!rotated) {
      // Lost a race with another use of the same token: treat as reuse.
      await this.revokeFamily(current.familyId);
      throw invalidSession();
    }
    return { userId: current.userId, token: next };
  }

  /** Revokes the family of the given token (logout). Unknown tokens are ignored. */
  async revokeByToken(token: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(token) },
      select: { familyId: true },
    });
    if (row) await this.revokeFamily(row.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private row(userId: string, familyId: string, token: string, meta: ClientMeta) {
    return {
      id: newId(),
      userId,
      familyId,
      tokenHash: hashRefreshToken(token),
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    };
  }
}
