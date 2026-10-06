import { Prisma, type WalletTransaction, type WalletTxKind } from '@prisma/client';
import { PREMIUM, WALLET_LIMITS, perkLimit, type PremiumDto, type WalletTransactionDto, type UserMini } from '@autoc/shared';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { isPremiumAt } from '../../common/premium';
import type { Tx } from '../../infra/prisma/prisma.service';

/*
 * Ledger primitives. Every balance change goes through `post` inside a transaction that already holds the
 * wallet row lock (`lockWallets`), so `balance_after` is exact and `balance >= 0` (DB CHECK) is never hit
 * by a race: callers check the balance under the lock first.
 */

const DAY_MS = 24 * 3600 * 1000;

export type LockedWallet = { userId: string; balance: bigint; frozen: boolean; frozenAt: Date | null };

/** Creates missing wallets (balance 0). */
export async function ensureWallets(db: Tx | Prisma.TransactionClient, userIds: string[]): Promise<void> {
  if (!userIds.length) return;
  await db.$executeRaw`
    INSERT INTO wallets (user_id, balance, frozen, created_at, updated_at)
    SELECT u, 0, false, now(), now() FROM unnest(${userIds}::uuid[]) AS u
    ON CONFLICT (user_id) DO NOTHING`;
}

/** The wallet row; created (balance 0) only when it doesn't exist yet, so plain reads never write. */
export async function readWallet(db: Tx | Prisma.TransactionClient, userId: string) {
  const w = await db.wallet.findUnique({ where: { userId } });
  if (w) return w;
  await ensureWallets(db, [userId]);
  return db.wallet.findUniqueOrThrow({ where: { userId } });
}

/** Locks the wallets with `SELECT … FOR UPDATE` in user-id order (no deadlocks between opposite transfers). */
export async function lockWallets(tx: Tx | Prisma.TransactionClient, userIds: string[]): Promise<Map<string, LockedWallet>> {
  const ids = [...new Set(userIds)].sort();
  await ensureWallets(tx, ids);
  const rows = await tx.$queryRaw<LockedWallet[]>`
    SELECT user_id AS "userId", balance, frozen, frozen_at AS "frozenAt" FROM wallets
    WHERE user_id = ANY(${ids}::uuid[]) ORDER BY user_id FOR UPDATE`;
  return new Map(rows.map((r) => [r.userId, r]));
}

export type PostInput = {
  userId: string;
  kind: WalletTxKind;
  amount: number;
  counterpartyId?: string | null;
  ref?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
  id?: string;
};

/**
 * Applies one ledger row to a locked wallet. `seq` (per wallet, 1, 2, 3, …) and `created_at`
 * (clock_timestamp) are taken under the row lock, so ordering by seq always agrees with balance_after.
 */
export async function post(tx: Tx | Prisma.TransactionClient, input: PostInput): Promise<WalletTransaction> {
  if (!Number.isInteger(input.amount) || input.amount === 0) throw new Error('Ledger amount must be a non-zero integer');
  const [w] = await tx.$queryRaw<{ balance: bigint; seq: bigint; at: Date }[]>`
    UPDATE wallets SET balance = balance + ${input.amount}::bigint, last_seq = last_seq + 1, updated_at = now()
    WHERE user_id = ${input.userId}::uuid RETURNING balance, last_seq AS seq, clock_timestamp() AS at`;
  if (!w) throw new Error('Wallet must be locked before posting');
  return tx.walletTransaction.create({
    data: {
      id: input.id ?? newId(),
      userId: input.userId,
      kind: input.kind,
      amount: BigInt(input.amount),
      balanceAfter: w.balance,
      counterpartyId: input.counterpartyId ?? null,
      ref: input.ref ?? null,
      note: input.note ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      seq: w.seq,
      createdAt: w.at,
    },
  });
}

/** Coins sent with transfers in the rolling 24 h window. */
export async function sentLast24h(db: Tx | Prisma.TransactionClient, userId: string, now = new Date()): Promise<number> {
  const [row] = await db.$queryRaw<{ sent: bigint | null }[]>`
    SELECT -sum(amount) AS sent FROM wallet_transactions
    WHERE user_id = ${userId}::uuid AND kind = 'transfer_out' AND created_at > ${new Date(now.getTime() - DAY_MS)}`;
  return Number(row?.sent ?? 0);
}

/** Ledger pages: newest first by `seq` (the wallet's own order), cursor = the last seq seen. */
export const encodeSeqCursor = (seq: bigint) => Buffer.from(`s:${seq}`).toString('base64url');
export function decodeSeqCursor(cursor: string | undefined): bigint | null {
  if (!cursor) return null;
  const m = /^s:(\d{1,19})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!m) throw Errors.validation('Invalid cursor', [{ path: ['cursor'], message: 'Invalid cursor' }]);
  return BigInt(m[1]!);
}

/** One page of a user's ledger (optionally one kind), newest first. */
export async function ledgerPage(
  db: Tx | Prisma.TransactionClient,
  userId: string,
  q: { cursor?: string; limit: number; kind?: WalletTxKind },
): Promise<{ rows: WalletTransaction[]; nextCursor: string | null }> {
  const before = decodeSeqCursor(q.cursor);
  const rows = await db.walletTransaction.findMany({
    where: { userId, ...(q.kind ? { kind: q.kind } : {}), ...(before !== null ? { seq: { lt: before } } : {}) },
    orderBy: { seq: 'desc' },
    take: q.limit + 1,
  });
  const page = rows.slice(0, q.limit);
  return { rows: page, nextCursor: rows.length > q.limit ? encodeSeqCursor(page[page.length - 1]!.seq) : null };
}

export const toTxDto = (r: WalletTransaction, minis: Map<string, UserMini>): WalletTransactionDto => ({
  id: r.id,
  kind: r.kind,
  amount: Number(r.amount),
  balanceAfter: Number(r.balanceAfter),
  counterparty: r.counterpartyId ? (minis.get(r.counterpartyId) ?? null) : null,
  ref: r.ref,
  note: r.note,
  createdAt: r.createdAt.toISOString(),
});

export type SubscriptionRow = { startedAt: Date; currentPeriodEnd: Date; autoRenew: boolean } | null;

/** PremiumDto from the live subscription (null = none); `status` is `none` once the period has ended. */
export function premiumDto(sub: SubscriptionRow, now = new Date()): PremiumDto {
  const active = !!sub && isPremiumAt(sub.currentPeriodEnd, now);
  return {
    status: !active ? 'none' : sub!.autoRenew ? 'active' : 'cancelled',
    isPremium: active,
    autoRenew: active ? sub!.autoRenew : false,
    startedAt: active ? sub!.startedAt.toISOString() : null,
    currentPeriodEnd: active ? sub!.currentPeriodEnd.toISOString() : null,
    priceCoins: PREMIUM.priceCoins,
    periodDays: PREMIUM.periodDays,
    limits: {
      vehicles: perkLimit('vehicles', active),
      postMedia: perkLimit('postMedia', active),
      communitiesOwned: perkLimit('communitiesOwned', active),
      communityMemberships: perkLimit('communityMemberships', active),
    },
  };
}

export const walletFrozen = () => Errors.forbidden('Your wallet is frozen', 'WALLET_FROZEN');
export const insufficientFunds = (balance: bigint | number, extra: Record<string, unknown> = {}) =>
  Errors.conflict('INSUFFICIENT_FUNDS', 'Not enough coins', { balance: Number(balance), ...extra });

export const transferDailyRemaining = (sent: number, frozen: boolean) => (frozen ? 0 : Math.max(0, WALLET_LIMITS.transferDailyCap - sent));

export const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
