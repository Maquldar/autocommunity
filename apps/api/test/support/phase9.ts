import { newId } from '../../src/common/ids';
import { createUser, type CreateUserData, type TestApp } from './app';

export type U = { id: string; token: string };
const DAY_MS = 24 * 3600 * 1000;

/** An onboarded user whose account is `ageDays` old with the given rating (defaults: 30 days, 60). */
export async function seasoned(t: TestApp, opts: CreateUserData & { ageDays?: number; rating?: number } = {}): Promise<U> {
  const { ageDays = 30, rating = 60, ...data } = opts;
  const u = await createUser(t, data);
  await t.prisma.user.update({ where: { id: u.id }, data: { createdAt: new Date(Date.now() - ageDays * DAY_MS), rating } });
  return u;
}

/** Credits coins through the ledger (a `topup` row), creating the wallet when needed. */
export async function fund(t: TestApp, userId: string, amount: number): Promise<void> {
  await t.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO wallets (user_id, balance, updated_at) VALUES (${userId}::uuid, 0, now()) ON CONFLICT DO NOTHING`;
    const [w] = await tx.$queryRaw<{ balance: bigint }[]>`UPDATE wallets SET balance = balance + ${amount}::bigint WHERE user_id = ${userId}::uuid RETURNING balance`;
    await tx.walletTransaction.create({ data: { id: newId(), userId, kind: 'topup', amount: BigInt(amount), balanceAfter: w!.balance } });
  });
}

export async function balanceOf(t: TestApp, userId: string): Promise<number> {
  const w = await t.prisma.wallet.findUnique({ where: { userId } });
  return Number(w?.balance ?? 0);
}

/** Ledger invariant: the wallet balance equals the sum of its ledger rows, and no row ever went negative. */
export async function ledgerConsistent(t: TestApp, userId: string): Promise<boolean> {
  const [r] = await t.prisma.$queryRaw<{ sum: bigint | null; balance: bigint | null; negative: number }[]>`
    SELECT (SELECT sum(amount) FROM wallet_transactions WHERE user_id = ${userId}::uuid) AS sum,
           (SELECT balance FROM wallets WHERE user_id = ${userId}::uuid) AS balance,
           (SELECT count(*)::int FROM wallet_transactions WHERE user_id = ${userId}::uuid AND balance_after < 0) AS negative`;
  return Number(r?.sum ?? 0) === Number(r?.balance ?? 0) && r?.negative === 0;
}

/** An upload row (no file) with the given purpose. */
export async function uploadRow(t: TestApp, ownerId: string, purpose: string): Promise<string> {
  const id = newId();
  await t.prisma.upload.create({ data: { id, ownerId, purpose, key: `${purpose}/test/${id}.webp`, mime: 'image/webp', sizeBytes: 100, width: 10, height: 10 } });
  return id;
}

export async function vehicleOf(t: TestApp, userId: string, extra: { brand?: string; model?: string } = {}): Promise<string> {
  const id = newId();
  await t.prisma.vehicle.create({ data: { id, userId, brand: extra.brand ?? 'Toyota', model: extra.model ?? 'Camry', year: 2018, plate: '777ABC02', isPrimary: true } });
  return id;
}

export const admin = (t: TestApp) => createUser(t, { role: 'admin', nickname: `adm_${newId().slice(-8)}` });
