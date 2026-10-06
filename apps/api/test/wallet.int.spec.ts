import type { AdminWalletDto, CreateTopupResult, Paginated, TopupDto, TransferResult, WalletDto, WalletTransactionDto } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newId } from '../src/common/ids';
import { BackgroundTasks } from '../src/infra/tasks/background-tasks';
import { bearer, createTestApp, createUser, type TestApp } from './support/app';
import { admin, balanceOf, fund, ledgerConsistent, seasoned, type U } from './support/phase9';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const drain = () => t.app.get(BackgroundTasks).drain();
const get = (u: U, path: string) => request(t.http).get(`/api/v1${path}`).set(bearer(u.token));
const postAs = (u: U, path: string, body: object = {}) => request(t.http).post(`/api/v1${path}`).set(bearer(u.token)).send(body);
const key = () => `k-${newId()}`;
const transfer = (u: U, body: object) => postAs(u, '/wallet/transfers', { idempotencyKey: key(), ...body });

describe('GET /wallet', () => {
  it('creates an empty wallet with premium off and the full daily allowance', async () => {
    const me = await createUser(t);
    const w = (await get(me, '/wallet').expect(200)).body as WalletDto;
    expect(w).toMatchObject({ balance: 0, frozen: false, transferDailyRemaining: 100_000, premium: { status: 'none', isPremium: false, priceCoins: 1490, periodDays: 30 } });
    expect(w.premium.limits).toEqual({ vehicles: 5, postMedia: 6, communitiesOwned: 10, communityMemberships: 50 });
  });
});

describe('top-ups (demo provider)', () => {
  it('validates the amount and returns an in-app checkout URL; top-ups are private', async () => {
    const me = await createUser(t);
    const other = await createUser(t);
    for (const amount of [499, 200_001, 1000.5, '1000']) await postAs(me, '/wallet/topups', { amount }).expect(400);
    const res = (await postAs(me, '/wallet/topups', { amount: 5000 }).expect(201)).body as CreateTopupResult;
    expect(res.topup).toMatchObject({ amount: 5000, status: 'pending', provider: 'demo', cardLast4: null, completedAt: null });
    expect(res.checkoutUrl).toBe(`http://localhost:3000/wallet/checkout/${res.topup.id}`);
    expect((await get(me, `/wallet/topups/${res.topup.id}`).expect(200)).body.id).toBe(res.topup.id);
    await get(other, `/wallet/topups/${res.topup.id}`).expect(404);
    await postAs(other, `/wallet/topups/${res.topup.id}/demo-confirm`, { cardNumber: '4242 4242 4242 4242' }).expect(404);
  });

  it('the test card credits once; a repeated confirm returns the same top-up', async () => {
    const me = await createUser(t);
    const { topup } = (await postAs(me, '/wallet/topups', { amount: 2500 }).expect(201)).body as CreateTopupResult;
    const done = (await postAs(me, `/wallet/topups/${topup.id}/demo-confirm`, { cardNumber: '4242 4242 4242 4242', expiry: '12/30', cvc: '123' }).expect(200)).body as TopupDto;
    expect(done).toMatchObject({ status: 'succeeded', cardLast4: '4242' });
    const again = (await postAs(me, `/wallet/topups/${topup.id}/demo-confirm`, { cardNumber: '4242424242424242' }).expect(200)).body as TopupDto;
    expect(again).toEqual(done);
    expect(await balanceOf(t, me.id)).toBe(2500);
    const rows = await t.prisma.walletTransaction.findMany({ where: { userId: me.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'topup', ref: topup.id });
    expect(Number(rows[0]!.amount)).toBe(2500);
    expect(Number(rows[0]!.balanceAfter)).toBe(2500);
  });

  it('concurrent confirms of one top-up credit exactly once', async () => {
    const me = await createUser(t);
    const { topup } = (await postAs(me, '/wallet/topups', { amount: 1000 }).expect(201)).body as CreateTopupResult;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => postAs(me, `/wallet/topups/${topup.id}/demo-confirm`, { cardNumber: '4242424242424242' })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(await balanceOf(t, me.id)).toBe(1000);
    expect(await t.prisma.walletTransaction.count({ where: { userId: me.id } })).toBe(1);
  });

  it('any other card is declined (402) and the top-up is final; expired top-ups → 409', async () => {
    const me = await createUser(t);
    const { topup } = (await postAs(me, '/wallet/topups', { amount: 1000 }).expect(201)).body as CreateTopupResult;
    expect((await postAs(me, `/wallet/topups/${topup.id}/demo-confirm`, { cardNumber: '4000 0000 0000 0002' }).expect(402)).body.error.code).toBe('PAYMENT_DECLINED');
    expect((await get(me, `/wallet/topups/${topup.id}`)).body).toMatchObject({ status: 'declined', cardLast4: '0002' });
    expect((await postAs(me, `/wallet/topups/${topup.id}/demo-confirm`, { cardNumber: '4242424242424242' }).expect(409)).body.error.code).toBe('TOPUP_NOT_PENDING');
    await postAs(me, `/wallet/topups/${topup.id}/demo-confirm`, { cardNumber: '42' }).expect(400);

    const late = ((await postAs(me, '/wallet/topups', { amount: 1000 }).expect(201)).body as CreateTopupResult).topup;
    await t.prisma.topup.update({ where: { id: late.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await postAs(me, `/wallet/topups/${late.id}/demo-confirm`, { cardNumber: '4242424242424242' }).expect(409)).body.error.code).toBe('TOPUP_EXPIRED');
    expect((await get(me, `/wallet/topups/${late.id}`)).body.status).toBe('expired');
    expect(await balanceOf(t, me.id)).toBe(0);
  });

  it('10 top-ups per hour; a frozen wallet can neither start nor complete one', async () => {
    const me = await createUser(t);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(((await postAs(me, '/wallet/topups', { amount: 500 }).expect(201)).body as CreateTopupResult).topup.id);
    expect((await postAs(me, '/wallet/topups', { amount: 500 }).expect(429)).body.error.code).toBe('RATE_LIMITED');

    await t.prisma.wallet.update({ where: { userId: me.id }, data: { frozen: true } });
    expect((await postAs(me, `/wallet/topups/${ids[0]}/demo-confirm`, { cardNumber: '4242424242424242' }).expect(403)).body.error.code).toBe('WALLET_FROZEN');
    const fresh = await createUser(t);
    await get(fresh, '/wallet').expect(200);
    await t.prisma.wallet.update({ where: { userId: fresh.id }, data: { frozen: true } });
    expect((await postAs(fresh, '/wallet/topups', { amount: 500 }).expect(403)).body.error.code).toBe('WALLET_FROZEN');
  });
});

describe('transfers', () => {
  it('moves coins atomically with paired ledger rows, a message and a notification', async () => {
    const a = await seasoned(t, { name: 'Айдар' });
    const b = await seasoned(t, { nickname: `rcv_${newId().slice(-6)}` });
    await fund(t, a.id, 5000);
    const res = (await transfer(a, { toUserId: b.id, amount: 1200, message: 'За бензин' }).expect(201)).body as TransferResult;
    expect(res.balance).toBe(3800);
    expect(res.transaction).toMatchObject({ kind: 'transfer_out', amount: -1200, balanceAfter: 3800, note: 'За бензин', counterparty: { id: b.id, isPremium: false } });
    expect(await balanceOf(t, b.id)).toBe(1200);
    const inRow = await t.prisma.walletTransaction.findFirstOrThrow({ where: { userId: b.id, kind: 'transfer_in' } });
    expect(inRow).toMatchObject({ counterpartyId: a.id, ref: res.transaction.id, note: 'За бензин' });
    expect(res.transaction.ref).toBe(inRow.id);

    const n = await t.prisma.notification.findFirstOrThrow({ where: { userId: b.id, type: 'wallet_received' } });
    expect(n.payload).toMatchObject({ transactionId: inRow.id, amount: 1200, message: 'За бензин', user: { id: a.id, name: 'Айдар' } });

    // by nickname (case-insensitive)
    const nick = (await t.prisma.user.findUniqueOrThrow({ where: { id: b.id } })).nickname!;
    await transfer(a, { toNickname: nick.toUpperCase(), amount: 100 }).expect(201);
    expect(await balanceOf(t, b.id)).toBe(1300);
    expect(await ledgerConsistent(t, a.id)).toBe(true);
    expect(await ledgerConsistent(t, b.id)).toBe(true);

    const page = (await get(b, '/wallet/transactions?kind=transfer_in&limit=1').expect(200)).body as Paginated<WalletTransactionDto>;
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ amount: 100, counterparty: { id: a.id } });
    const next = (await get(b, `/wallet/transactions?kind=transfer_in&limit=1&cursor=${page.nextCursor}`).expect(200)).body as Paginated<WalletTransactionDto>;
    expect(next.items[0]).toMatchObject({ amount: 1200 });
  });

  it('enforces target, sender and amount rules', async () => {
    const a = await seasoned(t);
    const b = await seasoned(t);
    await fund(t, a.id, 300);
    expect((await transfer(a, { toUserId: a.id, amount: 100 }).expect(400)).body.error.code).toBe('INVALID_TARGET');
    await transfer(a, { toUserId: newId(), amount: 100 }).expect(404);
    await transfer(a, { toUserId: (await createUser(t, { status: 'deleted' })).id, amount: 100 }).expect(404);
    await transfer(a, { toUserId: (await createUser(t, { onboarded: false })).id, amount: 100 }).expect(404);
    expect((await transfer(a, { toUserId: (await createUser(t, { status: 'blocked' })).id, amount: 100 }).expect(409)).body.error.code).toBe('RECIPIENT_UNAVAILABLE');
    for (const amount of [99, 50_001]) await transfer(a, { toUserId: b.id, amount }).expect(400);
    await postAs(a, '/wallet/transfers', { toUserId: b.id, amount: 100 }).expect(400); // no idempotency key
    expect((await transfer(a, { toUserId: b.id, amount: 500 }).expect(409)).body.error).toMatchObject({ code: 'INSUFFICIENT_FUNDS', details: { balance: 300 } });

    const young = await seasoned(t, { ageDays: 0.5 });
    await fund(t, young.id, 1000);
    const tooNew = (await transfer(young, { toUserId: b.id, amount: 100 }).expect(403)).body.error;
    expect(tooNew.code).toBe('ACCOUNT_TOO_NEW');
    expect(tooNew.details.minHours).toBe(24);
    const low = await seasoned(t, { rating: 29 });
    await fund(t, low.id, 1000);
    expect((await transfer(low, { toUserId: b.id, amount: 100 }).expect(403)).body.error).toMatchObject({ code: 'RATING_TOO_LOW', details: { min: 30 } });

    await t.prisma.wallet.update({ where: { userId: a.id }, data: { frozen: true } });
    expect((await transfer(a, { toUserId: b.id, amount: 100 }).expect(403)).body.error.code).toBe('WALLET_FROZEN');
    await t.prisma.wallet.update({ where: { userId: a.id }, data: { frozen: false } });
    await get(b, '/wallet');
    await t.prisma.wallet.update({ where: { userId: b.id }, data: { frozen: true } });
    expect((await transfer(a, { toUserId: b.id, amount: 100 }).expect(409)).body.error.code).toBe('RECIPIENT_UNAVAILABLE');
    expect(await balanceOf(t, a.id)).toBe(300);
  });

  it('daily cap of 100 000 per sender over a rolling 24 h', async () => {
    const a = await seasoned(t);
    const b = await seasoned(t);
    await fund(t, a.id, 150_000);
    await transfer(a, { toUserId: b.id, amount: 50_000 }).expect(201);
    await transfer(a, { toUserId: b.id, amount: 49_000 }).expect(201);
    expect((await get(a, '/wallet')).body.transferDailyRemaining).toBe(1000);
    expect((await transfer(a, { toUserId: b.id, amount: 1001 }).expect(409)).body.error).toMatchObject({ code: 'TRANSFER_DAILY_CAP', details: { cap: 100_000, remaining: 1000 } });
    await transfer(a, { toUserId: b.id, amount: 1000 }).expect(201);
  });

  it('idempotency: a replay returns the original (200); the same key for another transfer → 409', async () => {
    const a = await seasoned(t);
    const b = await seasoned(t);
    const c = await seasoned(t);
    await fund(t, a.id, 1000);
    const k = key();
    const first = (await postAs(a, '/wallet/transfers', { toUserId: b.id, amount: 300, idempotencyKey: k }).expect(201)).body as TransferResult;
    const replay = (await postAs(a, '/wallet/transfers', { toUserId: b.id, amount: 300, idempotencyKey: k }).expect(200)).body as TransferResult;
    expect(replay.transaction.id).toBe(first.transaction.id);
    expect(await balanceOf(t, a.id)).toBe(700);
    expect((await postAs(a, '/wallet/transfers', { toUserId: c.id, amount: 300, idempotencyKey: k }).expect(409)).body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await postAs(a, '/wallet/transfers', { toUserId: b.id, amount: 301, idempotencyKey: k }).expect(409)).body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // the same key sent concurrently moves the coins once
    const k2 = key();
    const results = await Promise.all(Array.from({ length: 5 }, () => postAs(a, '/wallet/transfers', { toUserId: b.id, amount: 100, idempotencyKey: k2 })));
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.transaction.id)).size).toBe(1);
    expect(await balanceOf(t, a.id)).toBe(600);
  });

  it('concurrent transfers never overdraw, and opposite transfers do not deadlock', async () => {
    const a = await seasoned(t);
    const rcpts = await Promise.all(Array.from({ length: 4 }, () => seasoned(t)));
    await fund(t, a.id, 1000);
    // 2 batches (10/min rate limit): 9 + 9 requests of 100 for a balance of 1000 → exactly 10 succeed.
    const batch = () => Promise.all(Array.from({ length: 9 }, (_, i) => transfer(a, { toUserId: rcpts[i % 4]!.id, amount: 100 })));
    const first = await batch();
    await t.redis.del(`rl:wallet-transfer:${a.id}`);
    const second = await batch();
    const all = [...first, ...second];
    expect(all.filter((r) => r.status === 201)).toHaveLength(10);
    expect(all.filter((r) => r.status === 409).every((r) => r.body.error.code === 'INSUFFICIENT_FUNDS')).toBe(true);
    expect(await balanceOf(t, a.id)).toBe(0);
    expect(await ledgerConsistent(t, a.id)).toBe(true);
    for (const r of rcpts) expect(await ledgerConsistent(t, r.id)).toBe(true);

    const x = await seasoned(t);
    const y = await seasoned(t);
    await fund(t, x.id, 2000);
    await fund(t, y.id, 2000);
    const cross = await Promise.all(
      Array.from({ length: 8 }, (_, i) => (i % 2 ? transfer(x, { toUserId: y.id, amount: 100 }) : transfer(y, { toUserId: x.id, amount: 100 }))),
    );
    expect(cross.map((r) => r.status)).toEqual(Array(8).fill(201));
    expect((await balanceOf(t, x.id)) + (await balanceOf(t, y.id))).toBe(4000);
  });

  it('10 transfers per minute', async () => {
    const a = await seasoned(t);
    const b = await seasoned(t);
    await fund(t, a.id, 5000);
    for (let i = 0; i < 10; i++) await transfer(a, { toUserId: b.id, amount: 100 }).expect(201);
    expect((await transfer(a, { toUserId: b.id, amount: 100 }).expect(429)).body.error.code).toBe('RATE_LIMITED');
  });

  it('the ledger is append-only and balances cannot go negative', async () => {
    const a = await seasoned(t);
    await fund(t, a.id, 100);
    await expect(t.prisma.$executeRaw`UPDATE wallet_transactions SET amount = 1 WHERE user_id = ${a.id}::uuid`).rejects.toThrow(/append-only/);
    await expect(t.prisma.$executeRaw`DELETE FROM wallet_transactions WHERE user_id = ${a.id}::uuid`).rejects.toThrow(/append-only/);
    await expect(t.prisma.$executeRaw`UPDATE wallets SET balance = -1 WHERE user_id = ${a.id}::uuid`).rejects.toThrow(/wallets_balance_non_negative/);
  });

  it('wallet_funnel: 3 new accounts sending into one account in 24 h → one flag on the recipient', async () => {
    const target = await seasoned(t);
    const senders = await Promise.all(Array.from({ length: 4 }, () => seasoned(t, { ageDays: 2 })));
    for (const [i, s] of senders.entries()) {
      await fund(t, s.id, 500);
      await transfer(s, { toUserId: target.id, amount: 200 }).expect(201);
      await drain();
      expect(await t.prisma.fraudFlag.count({ where: { userId: target.id, kind: 'wallet_funnel' } })).toBe(i >= 2 ? 1 : 0);
    }
    const flag = await t.prisma.fraudFlag.findFirstOrThrow({ where: { userId: target.id, kind: 'wallet_funnel' } });
    expect((flag.details as { senderIds: string[] }).senderIds).toHaveLength(3);

    // old accounts don't count
    const other = await seasoned(t);
    for (let i = 0; i < 3; i++) {
      const s = await seasoned(t, { ageDays: 30 });
      await fund(t, s.id, 500);
      await transfer(s, { toUserId: other.id, amount: 200 }).expect(201);
    }
    await drain();
    expect(await t.prisma.fraudFlag.count({ where: { userId: other.id, kind: 'wallet_funnel' } })).toBe(0);
  });
});

describe('security review fixes', () => {
  it('a nickname is matched exactly: `_` and `%` are not wildcards', async () => {
    const a = await seasoned(t);
    const tag = newId().slice(-6);
    const victim = await seasoned(t, { nickname: `ilyas.${tag}` });
    await fund(t, a.id, 1000);
    for (const nick of [`ilyas_${tag}`, `ilyas%${tag}`, `%${tag}`, `ilyas.${tag.slice(0, 5)}_`]) {
      await transfer(a, { toNickname: nick, amount: 100 }).expect((r) => expect([400, 404]).toContain(r.status));
    }
    expect(await balanceOf(t, victim.id)).toBe(0);
    await transfer(a, { toNickname: `ILYAS.${tag.toUpperCase()}`, amount: 100 }).expect(201); // still case-insensitive
    expect(await balanceOf(t, victim.id)).toBe(100);
  });

  it('ledger order: under concurrency seq order matches balance_after, and pages neither skip nor repeat', async () => {
    const hub = await seasoned(t);
    const senders = await Promise.all(Array.from({ length: 10 }, () => seasoned(t)));
    await fund(t, hub.id, 5000);
    for (const s of senders) await fund(t, s.id, 1000);
    await Promise.all([
      ...senders.map((s, i) => transfer(s, { toUserId: hub.id, amount: 100 + i }).expect(201)),
      ...senders.slice(0, 5).map((s) => transfer(hub, { toUserId: s.id, amount: 300 }).expect(201)),
    ]);
    const rows = await t.prisma.walletTransaction.findMany({ where: { userId: hub.id }, orderBy: { seq: 'asc' } });
    expect(rows.map((r) => Number(r.seq))).toEqual(rows.map((_, i) => i + 1));
    let prev = 0;
    for (const r of rows) {
      expect(prev + Number(r.amount)).toBe(Number(r.balanceAfter));
      prev = Number(r.balanceAfter);
    }
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.createdAt.getTime()).toBeGreaterThanOrEqual(rows[i - 1]!.createdAt.getTime());
    expect(prev).toBe(await balanceOf(t, hub.id));

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Paginated<WalletTransactionDto> = (await get(hub, `/wallet/transactions?limit=4${cursor ? `&cursor=${cursor}` : ''}`).expect(200)).body;
      seen.push(...page.items.map((x) => x.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([...rows].reverse().map((r) => r.id));
    await get(hub, '/wallet/transactions?cursor=bogus').expect(400);
  });

  it('reading a wallet that exists does not write', async () => {
    const u = await seasoned(t);
    const adm = await admin(t);
    await get(u, '/wallet').expect(200); // first read creates it
    const spy = vi.spyOn(t.prisma, '$executeRaw');
    try {
      await get(u, '/wallet').expect(200);
      await get(adm, `/admin/users/${u.id}/wallet`).expect(200);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('admin wallet', () => {
  it('views, adjusts (never below 0), freezes and unfreezes with audited notes and notifications', async () => {
    const adm = await admin(t);
    const user = await seasoned(t);
    const peer = await seasoned(t);
    await get(user, '/admin/users/' + user.id + '/wallet').expect(403);

    const w0 = (await get(adm, `/admin/users/${user.id}/wallet`).expect(200)).body as AdminWalletDto;
    expect(w0).toMatchObject({ userId: user.id, balance: 0, frozen: false, frozenAt: null, sentLast24h: 0 });

    await postAs(adm, `/admin/users/${user.id}/wallet/adjust`, { amount: 500 }).expect(400);
    await postAs(adm, `/admin/users/${user.id}/wallet/adjust`, { amount: 0, note: 'nothing' }).expect(400);
    expect(((await postAs(adm, `/admin/users/${user.id}/wallet/adjust`, { amount: 700, note: 'Компенсация' }).expect(200)).body as AdminWalletDto).balance).toBe(700);
    expect((await postAs(adm, `/admin/users/${user.id}/wallet/adjust`, { amount: -701, note: 'Ошибка' }).expect(409)).body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(((await postAs(adm, `/admin/users/${user.id}/wallet/adjust`, { amount: -200, note: 'Ошибка' }).expect(200)).body as AdminWalletDto).balance).toBe(500);

    const frozen = (await postAs(adm, `/admin/users/${user.id}/wallet/freeze`, { note: 'Проверка' }).expect(200)).body as AdminWalletDto;
    expect(frozen.frozen).toBe(true);
    expect(frozen.frozenAt).not.toBeNull();
    expect((await postAs(adm, `/admin/users/${user.id}/wallet/freeze`, { note: 'Проверка' }).expect(409)).body.error.code).toBe('WALLET_ALREADY_FROZEN');
    expect((await transfer(user, { toUserId: peer.id, amount: 100 }).expect(403)).body.error.code).toBe('WALLET_FROZEN');
    // adjustments still work on a frozen wallet
    await postAs(adm, `/admin/users/${user.id}/wallet/adjust`, { amount: 100, note: 'Бонус' }).expect(200);
    await postAs(adm, `/admin/users/${user.id}/wallet/unfreeze`, { note: 'Снято' }).expect(200);
    expect((await postAs(adm, `/admin/users/${user.id}/wallet/unfreeze`, { note: 'Снято' }).expect(409)).body.error.code).toBe('WALLET_NOT_FROZEN');

    const actions = await t.prisma.adminAction.findMany({ where: { targetUserId: user.id }, orderBy: { createdAt: 'asc' } });
    expect(actions.map((a) => a.action)).toEqual(['wallet.adjust', 'wallet.adjust', 'wallet.freeze', 'wallet.adjust', 'wallet.unfreeze']);
    expect(actions.every((a) => a.targetType === 'wallet' && a.note)).toBe(true);
    const notes = await t.prisma.notification.findMany({ where: { userId: user.id, type: 'wallet_admin' }, orderBy: { createdAt: 'asc' } });
    expect(notes.map((n) => (n.payload as { action: string }).action)).toEqual(['adjust', 'adjust', 'freeze', 'adjust', 'unfreeze']);
    expect(notes[0]!.payload).toMatchObject({ amount: 700, balance: 700, note: 'Компенсация' });

    const txs = (await get(adm, `/admin/users/${user.id}/wallet/transactions`).expect(200)).body as Paginated<WalletTransactionDto & { idempotencyKey: string | null }>;
    expect(txs.items.map((x) => x.amount)).toEqual([100, -200, 700]);
    expect(txs.items[0]).toMatchObject({ kind: 'admin_adjust', note: 'Бонус', idempotencyKey: null });
    expect(await ledgerConsistent(t, user.id)).toBe(true);
  });

  it('admins cannot act on themselves or other admins; unknown users → 404', async () => {
    const adm = await admin(t);
    const other = await admin(t);
    expect((await postAs(adm, `/admin/users/${adm.id}/wallet/adjust`, { amount: 100, note: 'self' }).expect(403)).body.error.code).toBe('INVALID_TARGET');
    expect((await postAs(adm, `/admin/users/${other.id}/wallet/freeze`, { note: 'admin' }).expect(403)).body.error.code).toBe('INVALID_TARGET');
    await get(adm, `/admin/users/${newId()}/wallet`).expect(404);
  });
});
