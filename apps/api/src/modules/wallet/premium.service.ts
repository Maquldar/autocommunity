import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { PremiumSubscription } from '@prisma/client';
import {
  PREMIUM,
  type PremiumDto,
  type PremiumExpiredPayload,
  type PremiumReminderPayload,
  type PremiumRenewedPayload,
} from '@autoc/shared';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { AccountDeletionHooks } from '../../infra/tasks/account-deletion-hooks';
import { NotificationsService } from '../notifications/notifications.service';
import { insufficientFunds, lockWallets, post, premiumDto, walletFrozen } from './wallet-ledger';

const DAY_MS = 24 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;

const notPremium = () => Errors.conflict('NOT_PREMIUM', "You don't have an active premium subscription");

export type RenewalReport = { renewed: number; expired: number; reminded: number };

/**
 * Premium for coins (API.md §9.2): 1 490 coins per 30 days from the wallet. `users.premium_until` caches
 * the paid period so every user view knows `isPremium` without a join.
 */
@Injectable()
export class PremiumService implements OnModuleInit {
  private readonly logger = new Logger(PremiumService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly deletionHooks: AccountDeletionHooks,
  ) {}

  onModuleInit(): void {
    // A deleted account is never charged again; the paid period simply runs out.
    this.deletionHooks.register('premium', async (userId) => {
      await this.prisma.premiumSubscription.updateMany({ where: { userId, endedAt: null }, data: { autoRenew: false } });
    });
  }

  async get(userId: string, now = new Date()): Promise<PremiumDto> {
    return premiumDto(await this.prisma.premiumSubscription.findFirst({ where: { userId, endedAt: null } }), now);
  }

  /** Charges 1 490 now. The wallet row lock serializes concurrent subscribes, so only one charges. */
  async subscribe(userId: string, now = new Date()): Promise<PremiumDto> {
    const sub = await this.prisma.$transaction(async (tx) => {
      const wallet = (await lockWallets(tx, [userId])).get(userId)!;
      const live = await tx.premiumSubscription.findFirst({ where: { userId, endedAt: null } });
      if (live && live.currentPeriodEnd > now) throw Errors.conflict('ALREADY_PREMIUM', 'Premium is already active');
      if (wallet.frozen) throw walletFrozen();
      if (wallet.balance < BigInt(PREMIUM.priceCoins)) throw insufficientFunds(wallet.balance, { price: PREMIUM.priceCoins });
      // A period that ended before the renewal job ran is closed here.
      if (live) await tx.premiumSubscription.update({ where: { id: live.id }, data: { endedAt: now, endReason: live.autoRenew ? 'insufficient_funds' : 'cancelled' } });
      const id = newId();
      const end = new Date(now.getTime() + PREMIUM.periodDays * DAY_MS);
      const created = await tx.premiumSubscription.create({ data: { id, userId, startedAt: now, currentPeriodEnd: end, autoRenew: true } });
      await post(tx, { userId, kind: 'subscription', amount: -PREMIUM.priceCoins, ref: id });
      await tx.user.update({ where: { id: userId }, data: { premiumUntil: end } });
      return created;
    });
    return premiumDto(sub, now);
  }

  async cancel(userId: string, now = new Date()): Promise<PremiumDto> {
    return this.setAutoRenew(userId, false, now);
  }

  async resume(userId: string, now = new Date()): Promise<PremiumDto> {
    return this.setAutoRenew(userId, true, now);
  }

  private async setAutoRenew(userId: string, autoRenew: boolean, now: Date): Promise<PremiumDto> {
    const live = await this.prisma.premiumSubscription.findFirst({ where: { userId, endedAt: null } });
    if (!live || live.currentPeriodEnd <= now) throw notPremium();
    const updated = live.autoRenew === autoRenew ? live : await this.prisma.premiumSubscription.update({ where: { id: live.id }, data: { autoRenew } });
    return premiumDto(updated, now);
  }

  /* ------------------------------------------------------------------ daily job */

  /**
   * Renew (period ends within 24 h, auto-renew on, enough coins, wallet not frozen) → expire (period over)
   * → 3-day reminders. Every step is conditional on the row's current state, so re-runs do nothing twice.
   */
  async runRenewals(now = new Date()): Promise<RenewalReport> {
    const report: RenewalReport = { renewed: 0, expired: 0, reminded: 0 };
    const due = await this.prisma.premiumSubscription.findMany({
      where: { endedAt: null, autoRenew: true, currentPeriodEnd: { lte: new Date(now.getTime() + PREMIUM.renewAheadHours * HOUR_MS) } },
      select: { id: true },
    });
    for (const { id } of due) {
      try {
        if (await this.renewOne(id, now)) report.renewed++;
      } catch (err) {
        this.logger.warn({ err, subscriptionId: id }, 'Premium renewal failed');
      }
    }
    const ended = await this.prisma.premiumSubscription.findMany({ where: { endedAt: null, currentPeriodEnd: { lte: now } } });
    for (const sub of ended) {
      try {
        if (await this.expireOne(sub, now)) report.expired++;
      } catch (err) {
        this.logger.warn({ err, subscriptionId: sub.id }, 'Premium expiry failed');
      }
    }
    const soon = await this.prisma.premiumSubscription.findMany({
      where: { endedAt: null, currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + PREMIUM.reminderDays * DAY_MS) } },
    });
    for (const sub of soon) {
      try {
        if (await this.remindOne(sub)) report.reminded++;
      } catch (err) {
        this.logger.warn({ err, subscriptionId: sub.id }, 'Premium reminder failed');
      }
    }
    return report;
  }

  /** Charges one period. The idempotency key (subscription + period end) makes a double charge impossible. */
  private async renewOne(subId: string, now: Date): Promise<boolean> {
    const result = await this.prisma.$transaction(async (tx: Tx) => {
      const pre = await tx.premiumSubscription.findUnique({ where: { id: subId }, select: { userId: true } });
      if (!pre) return null;
      const wallet = (await lockWallets(tx, [pre.userId])).get(pre.userId)!;
      const [sub] = await tx.$queryRaw<PremiumSubscription[]>`
        SELECT id, user_id AS "userId", current_period_end AS "currentPeriodEnd", auto_renew AS "autoRenew", ended_at AS "endedAt"
        FROM premium_subscriptions WHERE id = ${subId}::uuid FOR UPDATE`;
      if (!sub || sub.endedAt || !sub.autoRenew || sub.currentPeriodEnd.getTime() > now.getTime() + PREMIUM.renewAheadHours * HOUR_MS) return null;
      if (wallet.frozen || wallet.balance < BigInt(PREMIUM.priceCoins)) return null;
      // A period that already lapsed restarts now (the user never pays for days they didn't have).
      const base = Math.max(sub.currentPeriodEnd.getTime(), now.getTime());
      const end = new Date(base + PREMIUM.periodDays * DAY_MS);
      const charge = await post(tx, {
        userId: sub.userId,
        kind: 'subscription',
        amount: -PREMIUM.priceCoins,
        ref: sub.id,
        idempotencyKey: `renew:${sub.id}:${sub.currentPeriodEnd.getTime()}`,
      });
      await tx.premiumSubscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: end } });
      await tx.user.update({ where: { id: sub.userId }, data: { premiumUntil: end } });
      return { userId: sub.userId, end, balance: Number(charge.balanceAfter) };
    });
    if (!result) return false;
    const payload: PremiumRenewedPayload = { periodEnd: result.end.toISOString(), priceCoins: PREMIUM.priceCoins, balance: result.balance };
    await this.notifications.create(result.userId, 'premium_renewed', payload);
    return true;
  }

  private async expireOne(sub: PremiumSubscription, now: Date): Promise<boolean> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: sub.userId }, select: { frozen: true } });
    const reason: PremiumExpiredPayload['reason'] = !sub.autoRenew ? 'cancelled' : wallet?.frozen ? 'wallet_frozen' : 'insufficient_funds';
    const { count } = await this.prisma.premiumSubscription.updateMany({
      where: { id: sub.id, endedAt: null, currentPeriodEnd: sub.currentPeriodEnd },
      data: { endedAt: now, endReason: reason },
    });
    if (!count) return false;
    await this.notifications.create(sub.userId, 'premium_expired', { reason } satisfies PremiumExpiredPayload);
    return true;
  }

  /** Once per period: `reminder_sent_for` records the period end it was sent for. */
  private async remindOne(sub: PremiumSubscription): Promise<boolean> {
    if (sub.reminderSentFor?.getTime() === sub.currentPeriodEnd.getTime()) return false;
    const { count } = await this.prisma.premiumSubscription.updateMany({
      where: { id: sub.id, endedAt: null, currentPeriodEnd: sub.currentPeriodEnd, OR: [{ reminderSentFor: null }, { reminderSentFor: { not: sub.currentPeriodEnd } }] },
      data: { reminderSentFor: sub.currentPeriodEnd },
    });
    if (!count) return false;
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: sub.userId }, select: { balance: true } });
    const balance = Number(wallet?.balance ?? 0);
    const payload: PremiumReminderPayload = {
      periodEnd: sub.currentPeriodEnd.toISOString(),
      autoRenew: sub.autoRenew,
      lowBalance: sub.autoRenew && balance < PREMIUM.priceCoins,
      priceCoins: PREMIUM.priceCoins,
      balance,
    };
    await this.notifications.create(sub.userId, 'premium_reminder', payload);
    return true;
  }
}
