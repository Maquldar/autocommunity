import type { Prisma, PrismaClient } from '@prisma/client';
import { perkLimit, PREMIUM_PERK_LIMITS, type PremiumPerkLimit } from '@autoc/shared';
import { Errors } from './errors/api-exception';

type Db = Prisma.TransactionClient | PrismaClient;

/** Premium while the paid period hasn't ended (`users.premium_until`, a cache of premium_subscriptions). */
export const isPremiumAt = (premiumUntil: Date | null | undefined, now = new Date()): boolean => !!premiumUntil && premiumUntil.getTime() > now.getTime();

export async function isPremiumUser(db: Db, userId: string, now = new Date()): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { premiumUntil: true } });
  return isPremiumAt(u?.premiumUntil, now);
}

/** The user's value of a premium-doubled limit. */
export async function userPerkLimit(db: Db, userId: string, kind: PremiumPerkLimit): Promise<number> {
  return perkLimit(kind, await isPremiumUser(db, userId));
}

/** `details { limit, premiumLimit }` for the doubled-limit errors (API.md §9.2). */
export const perkDetails = (kind: PremiumPerkLimit, limit: number) => ({ limit, premiumLimit: PREMIUM_PERK_LIMITS[kind].premium });

export const perkConflict = (code: string, message: string, kind: PremiumPerkLimit, limit: number) => Errors.conflict(code, message, perkDetails(kind, limit));
