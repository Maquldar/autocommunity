import { Inject, Injectable } from '@nestjs/common';
import type { UserRole } from '@autoc/shared';
import { jwtVerify, SignJWT } from 'jose';
import { ENV, type Env } from '../../config/env';
import { newId } from '../ids';

export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
const ISSUER = 'autocommunity';
const AUDIENCE = 'autocommunity-api';

export type AccessClaims = { sub: string; role: UserRole; jti: string; issuedAtMs: number };

/** Unix milliseconds embedded in the first 48 bits of a UUID v7. */
export function uuidV7Timestamp(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

@Injectable()
export class AccessTokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(ENV) env: Env) {
    this.key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  async sign(userId: string, role: UserRole): Promise<string> {
    // jti is a UUID v7, so its timestamp gives millisecond issue time for session revocation checks.
    return new SignJWT({ role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setJti(newId())
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SEC}s`)
      .sign(this.key);
  }

  /** Returns null for any invalid, expired or malformed token. */
  async verify(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
      const role = payload.role;
      if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string' || (role !== 'user' && role !== 'admin')) {
        return null;
      }
      return { sub: payload.sub, role, jti: payload.jti, issuedAtMs: uuidV7Timestamp(payload.jti) };
    } catch {
      return null;
    }
  }
}
