import { Injectable } from '@nestjs/common';
import { AuthProvider, Prisma, type User } from '@prisma/client';
import { LIMITS, RATING, type AuthResult, type Me } from '@autoc/shared';
import { randomBytes } from 'node:crypto';
import { AccessTokenService } from '../../common/auth/access-token.service';
import { SessionService } from '../../common/auth/session.service';
import { isUserBlocked, UserStateService } from '../../common/auth/user-state.service';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { UserViewService } from '../users/user-view.service';
import type { OAuthProfile } from './oauth-verifier.service';
import { RefreshTokenService, type ClientMeta } from './refresh-token.service';

/** Login result before cookies are written by the controller. */
export type Session = AuthResult & { refreshToken: string; csrfToken: string };

type IdentityProfile = { provider: AuthProvider; uid: string; email?: string | null; name?: string | null };

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly sessions: SessionService,
    private readonly userState: UserStateService,
    private readonly view: UserViewService,
  ) {}

  /** Phone already verified by OTP. */
  async loginWithPhone(phone: string, meta: ClientMeta): Promise<Session> {
    const { user, isNew } = await this.findOrCreateByPhone(phone);
    return this.startSession(user, isNew, meta);
  }

  async loginWithOAuth(provider: 'google' | 'apple', profile: OAuthProfile, meta: ClientMeta): Promise<Session> {
    const { user, isNew } = await this.findOrCreateByIdentity({ provider, uid: profile.uid, email: profile.email, name: profile.name });
    return this.startSession(user, isNew, meta);
  }

  async refresh(refreshToken: string, meta: ClientMeta): Promise<{ accessToken: string; refreshToken: string }> {
    const rotated = await this.refreshTokens.rotate(refreshToken, meta);
    const state = await this.userState.get(rotated.userId);
    if (!state || isUserBlocked(state)) {
      await this.sessions.revokeAll(rotated.userId);
      throw Errors.accountBlocked();
    }
    return { accessToken: await this.accessTokens.sign(rotated.userId, state.role), refreshToken: rotated.token };
  }

  logout(refreshToken: string | null): Promise<void> {
    return refreshToken ? this.refreshTokens.revokeByToken(refreshToken) : Promise.resolve();
  }

  logoutAll(userId: string): Promise<void> {
    return this.sessions.revokeAll(userId);
  }

  /** Attaches a verified phone to an existing account (OAuth users); phone numbers are unique. */
  async linkPhone(userId: string, phone: string): Promise<Me> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const owner = await tx.user.findUnique({ where: { phone }, select: { id: true } });
        if (owner && owner.id !== userId) throw phoneInUse();
        await tx.user.update({ where: { id: userId }, data: { phone, phoneVerifiedAt: new Date() } });
        await tx.authIdentity.deleteMany({ where: { userId, provider: 'phone', providerUid: { not: phone } } });
        await tx.authIdentity.upsert({
          where: { provider_providerUid: { provider: 'phone', providerUid: phone } },
          create: { id: newId(), userId, provider: 'phone', providerUid: phone },
          update: {},
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw phoneInUse();
      throw err;
    }
    return this.view.loadMe(userId);
  }

  /** Throws PHONE_IN_USE when the number belongs to another account. */
  async assertPhoneAvailable(userId: string, phone: string): Promise<void> {
    const owner = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
    if (owner && owner.id !== userId) throw phoneInUse();
  }

  private async startSession(user: User, isNew: boolean, meta: ClientMeta): Promise<Session> {
    if (isUserBlocked({ status: user.status, blockedUntil: user.blockedUntil?.toISOString() ?? null })) {
      throw Errors.accountBlocked();
    }
    const [accessToken, refreshToken] = await Promise.all([
      this.accessTokens.sign(user.id, user.role),
      this.refreshTokens.issue(user.id, meta),
    ]);
    return {
      accessToken,
      refreshToken,
      csrfToken: randomBytes(32).toString('base64url'),
      user: await this.view.loadMe(user.id),
      isNew,
    };
  }

  private async findOrCreateByPhone(phone: string): Promise<{ user: User; isNew: boolean }> {
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) {
      if (!existing.phoneVerifiedAt) {
        await this.prisma.user.update({ where: { id: existing.id }, data: { phoneVerifiedAt: new Date() } });
      }
      return { user: existing, isNew: false };
    }
    return this.findOrCreateByIdentity({ provider: 'phone', uid: phone });
  }

  private async findOrCreateByIdentity(profile: IdentityProfile): Promise<{ user: User; isNew: boolean }> {
    const find = () =>
      this.prisma.authIdentity.findUnique({
        where: { provider_providerUid: { provider: profile.provider, providerUid: profile.uid } },
        include: { user: true },
      });
    const identity = await find();
    if (identity) return { user: identity.user, isNew: false };

    const isPhone = profile.provider === 'phone';
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            id: newId(),
            name: (profile.name ?? '').trim().slice(0, LIMITS.nameMax),
            rating: RATING.start,
            phone: isPhone ? profile.uid : null,
            phoneVerifiedAt: isPhone ? new Date() : null,
          },
        });
        await tx.authIdentity.create({
          data: {
            id: newId(),
            userId: created.id,
            provider: profile.provider,
            providerUid: profile.uid,
            email: profile.email ?? null,
          },
        });
        return created;
      });
      return { user, isNew: true };
    } catch (err) {
      // A parallel first login created the same account; use it.
      if (!isUniqueViolation(err)) throw err;
      const raced = isPhone ? await this.prisma.user.findUnique({ where: { phone: profile.uid } }) : (await find())?.user;
      if (!raced) throw err;
      return { user: raced, isNew: false };
    }
  }
}

const phoneInUse = () => Errors.conflict('PHONE_IN_USE', 'This phone number is linked to another account');
