import { z } from 'zod';
import { COMMUNITY_LIMITS } from './communities';
import { LIMITS } from './constants';
import { FEED_LIMITS } from './feed';
import { idSchema, INVISIBLE_RE, nicknameSchema, paginationQuerySchema } from './schemas';
import type { UserMini } from './types';

/*
 * Phase 9 — wallet (internal coins) and premium. 1 coin = 1 ₸, shown in the UI as "монеты". Coins can be
 * topped up, transferred between users and spent on premium; there is no cash-out (SPEC §9).
 */

/* ---------- limits ---------- */

export const WALLET_LIMITS = {
  topupMin: 500,
  topupMax: 200_000,
  /** Top-ups created per user per hour. */
  topupsPerHour: 10,
  /** A pending top-up that isn't completed within this many minutes expires. */
  topupTtlMin: 30,
  transferMin: 100,
  transferMax: 50_000,
  /** Total sent per sender per rolling 24 h. */
  transferDailyCap: 100_000,
  transfersPerMinute: 10,
  transferMinAccountAgeHours: 24,
  transferMinRating: 30,
  transferMessageMax: 140,
  idempotencyKeyMin: 8,
  idempotencyKeyMax: 64,
  /** |amount| of one admin adjustment. */
  adminAdjustMaxAbs: 1_000_000,
} as const;

/** The demo provider's only approved card (spaces and dashes are ignored). Any other number is declined. */
export const DEMO_TEST_CARD = '4242424242424242';

export const PAYMENT_PROVIDERS = ['demo'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

/** `purchase` / `sale`: Phase 10 payments at partner points (API.md §10). */
export const WALLET_TX_KINDS = ['topup', 'transfer_out', 'transfer_in', 'subscription', 'admin_adjust', 'refund', 'purchase', 'sale'] as const;
export type WalletTxKind = (typeof WALLET_TX_KINDS)[number];

export const TOPUP_STATUSES = ['pending', 'succeeded', 'declined', 'expired'] as const;
export type TopupStatus = (typeof TOPUP_STATUSES)[number];

/* ---------- premium ---------- */

export const PREMIUM = {
  priceCoins: 1490,
  periodDays: 30,
  /** `premium_reminder` goes out this many days before the period ends. */
  reminderDays: 3,
  /**
   * The renewal job (daily) charges subscriptions whose period ends within this many hours, so a renewed
   * subscription never lapses between runs.
   */
  renewAheadHours: 24,
} as const;

/** Limits that premium doubles (only limits that already exist; see KNOWN_GAPS for the rest). */
export const PREMIUM_PERK_LIMITS = {
  vehicles: { base: LIMITS.vehiclesPerUser, premium: LIMITS.vehiclesPerUser * 2 },
  postMedia: { base: FEED_LIMITS.mediaMax, premium: FEED_LIMITS.mediaMaxPremium },
  communitiesOwned: { base: COMMUNITY_LIMITS.ownedPerUser, premium: COMMUNITY_LIMITS.ownedPerUser * 2 },
  communityMemberships: { base: COMMUNITY_LIMITS.membershipsPerUser, premium: COMMUNITY_LIMITS.membershipsPerUser * 2 },
} as const;
export type PremiumPerkLimit = keyof typeof PREMIUM_PERK_LIMITS;

/** The value of a doubled limit for a user. */
export const perkLimit = (kind: PremiumPerkLimit, isPremium: boolean): number =>
  isPremium ? PREMIUM_PERK_LIMITS[kind].premium : PREMIUM_PERK_LIMITS[kind].base;

/**
 * `none`: never subscribed or expired; `active`: renews automatically; `cancelled`: still active, but
 * auto-renew is off so it ends at `currentPeriodEnd`.
 */
export const PREMIUM_STATUSES = ['none', 'active', 'cancelled'] as const;
export type PremiumStatus = (typeof PREMIUM_STATUSES)[number];

export type PremiumDto = {
  status: PremiumStatus;
  /** status !== 'none' (and `currentPeriodEnd` is in the future). */
  isPremium: boolean;
  autoRenew: boolean;
  /** Start of the first period of the current subscription. */
  startedAt: string | null;
  currentPeriodEnd: string | null;
  priceCoins: number;
  periodDays: number;
  /** The user's limits as they apply now. */
  limits: { vehicles: number; postMedia: number; communitiesOwned: number; communityMemberships: number };
};

/* ---------- DTOs ---------- */

export type WalletDto = {
  balance: number;
  frozen: boolean;
  premium: PremiumDto;
  /** What the user can still send in the rolling 24 h window (0 when frozen). */
  transferDailyRemaining: number;
};

export type WalletTransactionDto = {
  id: string;
  kind: WalletTxKind;
  /** Signed: positive credits, negative debits. */
  amount: number;
  balanceAfter: number;
  /** The other user of a transfer; null for other kinds. */
  counterparty: UserMini | null;
  /** topup → top-up id, transfer → the paired transaction id, subscription → subscription id. */
  ref: string | null;
  /** Transfer message, or the admin's note for `admin_adjust`. */
  note: string | null;
  createdAt: string;
};

export type TopupDto = {
  id: string;
  amount: number;
  status: TopupStatus;
  provider: PaymentProviderName;
  /** Last 4 digits of the card used on the demo checkout (never the full number). */
  cardLast4: string | null;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
};

export type CreateTopupResult = { topup: TopupDto; checkoutUrl: string };

export type TransferResult = { transaction: WalletTransactionDto; balance: number };

/* ---------- request schemas ---------- */

const coins = (min: number, max: number) => z.number().int().min(min).max(max);

export const createTopupSchema = z.object({ amount: coins(WALLET_LIMITS.topupMin, WALLET_LIMITS.topupMax) });
export type CreateTopupInput = z.output<typeof createTopupSchema>;

/** Demo checkout: the card number decides (DEMO_TEST_CARD → succeeded, anything else → declined). */
export const demoConfirmTopupSchema = z.object({
  cardNumber: z
    .string()
    .trim()
    .regex(/^[0-9 -]{12,23}$/, 'Card number: 12–19 digits')
    .transform((v) => v.replace(/[ -]/g, ''))
    .refine((v) => v.length >= 12 && v.length <= 19, 'Card number: 12–19 digits'),
  expiry: z
    .string()
    .trim()
    .regex(/^(0[1-9]|1[0-2])\/\d{2}$/, 'MM/YY')
    .optional(),
  cvc: z
    .string()
    .trim()
    .regex(/^\d{3,4}$/)
    .optional(),
});
export type DemoConfirmTopupInput = z.output<typeof demoConfirmTopupSchema>;

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(WALLET_LIMITS.idempotencyKeyMin)
  .max(WALLET_LIMITS.idempotencyKeyMax)
  .regex(/^[A-Za-z0-9_-]+$/, 'Latin letters, digits, _ and -');

/** Exactly one of `toUserId` / `toNickname`. */
export const createTransferSchema = z
  .object({
    toUserId: idSchema.optional(),
    toNickname: nicknameSchema.optional(),
    amount: coins(WALLET_LIMITS.transferMin, WALLET_LIMITS.transferMax),
    message: z
      .string()
      .trim()
      .max(WALLET_LIMITS.transferMessageMax)
      .refine((v) => !INVISIBLE_RE.test(v) && !/[\n\t]/.test(v), 'Contains invalid characters')
      .optional()
      .transform((v) => (v ? v : undefined)),
    idempotencyKey: idempotencyKeySchema,
  })
  .refine((t) => (t.toUserId ? 1 : 0) + (t.toNickname ? 1 : 0) === 1, { path: ['toUserId'], message: 'Give exactly one of toUserId or toNickname' });
export type CreateTransferInput = z.output<typeof createTransferSchema>;

export const walletTransactionsQuerySchema = paginationQuerySchema.extend({ kind: z.enum(WALLET_TX_KINDS).optional() });

/* ---------- admin ---------- */

export const adminWalletAdjustSchema = z.object({
  amount: z
    .number()
    .int()
    .min(-WALLET_LIMITS.adminAdjustMaxAbs)
    .max(WALLET_LIMITS.adminAdjustMaxAbs)
    .refine((v) => v !== 0, 'Amount must not be 0'),
  note: z.string().trim().min(3).max(500),
});
export type AdminWalletAdjustInput = z.output<typeof adminWalletAdjustSchema>;

export type AdminWalletDto = {
  userId: string;
  balance: number;
  frozen: boolean;
  frozenAt: string | null;
  premium: PremiumDto;
  /** Sum of transfers sent in the rolling 24 h window. */
  sentLast24h: number;
};

export type AdminWalletTransactionDto = WalletTransactionDto & { idempotencyKey: string | null };

/* ---------- notification payloads ---------- */

/** To the recipient of a transfer (in-app + push). */
export type WalletReceivedPayload = { transactionId: string; amount: number; message: string | null; user: UserMini };
/** An admin changed the user's wallet. `note` is the admin's note (shown to the user). */
export type WalletAdminPayload = { action: 'adjust' | 'freeze' | 'unfreeze'; amount: number | null; balance: number; note: string };
/** 3 days before the period ends. `lowBalance` when auto-renew is on and the balance is below the price. */
export type PremiumReminderPayload = { periodEnd: string; autoRenew: boolean; lowBalance: boolean; priceCoins: number; balance: number };
export type PremiumRenewedPayload = { periodEnd: string; priceCoins: number; balance: number };
export type PremiumExpiredPayload = { reason: 'cancelled' | 'insufficient_funds' | 'wallet_frozen' };
