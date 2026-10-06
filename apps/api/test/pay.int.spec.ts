import type { Paginated, PayPointDto, PayPointManageDto, PayReceiptDto, ServiceDto } from '@autoc/shared';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { bearer, createTestApp, createUser, type TestApp } from './support/app';
import { admin, balanceOf, fund, ledgerConsistent, seasoned, type U } from './support/phase9';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const get = (u: U, path: string) => request(t.http).get(`/api/v1${path}`).set(bearer(u.token));
const send = (u: U, method: 'post' | 'put', path: string, body: object = {}) => request(t.http)[method](`/api/v1${path}`).set(bearer(u.token)).send(body);
const key = () => `pay_${newId()}`;
const GPAY = { token: 'examplePaymentMethodToken', cardNetwork: 'VISA', cardDetails: '1111' };

type Point = { id: string; tag: string; items: Record<string, string> };

/** A verified service that takes payments, with RP-like fuel prices (or the given items). */
async function seedPoint(opts: { ownerId?: string | null; accepts?: boolean; status?: string; items?: { name: string; priceCoins: number; unit: 'l' | 'pcs' | 'service' }[] } = {}): Promise<Point> {
  const id = newId();
  const tag = randomBytes(16).toString('base64url');
  await t.prisma.$executeRaw`
    INSERT INTO service_centers (id, name, category, description, address, phone, hours, location, rating, status, qr_secret,
                                 accepts_payments, pay_tag, owner_id, updated_at)
    VALUES (${id}::uuid, ${`АЗС ${id.slice(-6)}`}, 'fuel'::"ServiceCategory", 'desc', 'пр. Райымбека, 480', NULL, '{}'::jsonb,
            ST_SetSRID(ST_MakePoint(76.87::float8, 43.26::float8), 4326)::geography, 3.5, ${opts.status ?? 'verified'}::"ServiceStatus",
            ${randomBytes(16).toString('hex')}, ${opts.accepts ?? true}, ${tag}, ${opts.ownerId ?? null}::uuid, now())`;
  const items: Record<string, string> = {};
  const list = opts.items ?? [
    { name: 'АИ-92', priceCoins: 205, unit: 'l' as const },
    { name: 'АИ-95', priceCoins: 245, unit: 'l' as const },
    { name: 'ДТ', priceCoins: 290, unit: 'l' as const },
  ];
  for (const [i, item] of list.entries()) {
    const itemId = newId();
    await t.prisma.payItem.create({ data: { id: itemId, serviceId: id, ...item, sortOrder: i } });
    items[item.name] = itemId;
  }
  return { id, tag, items };
}

const buy = (u: U, body: object) => send(u, 'post', '/pay/orders', { method: 'coins', idempotencyKey: key(), ...body });

describe('point info and payTag resolution', () => {
  it('resolves a partner by service id and by its opaque tag; never non-partners or raw ids as tags', async () => {
    const me = await createUser(t);
    const p = await seedPoint();
    const byId = (await get(me, `/pay/points/${p.id}`).expect(200)).body as PayPointDto;
    expect(byId).toMatchObject({ serviceId: p.id, category: 'fuel', address: 'пр. Райымбека, 480', logoUrl: null });
    expect(byId.items.map((i) => [i.name, i.priceCoins, i.unit])).toEqual([
      ['АИ-92', 205, 'l'],
      ['АИ-95', 245, 'l'],
      ['ДТ', 290, 'l'],
    ]);
    expect((await get(me, `/pay/t/${p.tag}`).expect(200)).body).toEqual(byId);
    // The tag is not the id, and the id is not a tag.
    expect(p.tag).not.toContain(p.id);
    await get(me, `/pay/t/${p.id}`).expect(404);
    await get(me, `/pay/t/${randomBytes(16).toString('base64url')}`).expect(404);
    await get(me, '/pay/t/bad%20tag').expect(400);

    const off = await seedPoint({ accepts: false });
    await get(me, `/pay/points/${off.id}`).expect(404);
    await get(me, `/pay/t/${off.tag}`).expect(404);
    const pending = await seedPoint({ status: 'pending' });
    await get(me, `/pay/t/${pending.tag}`).expect(404);

    const svc = (await get(me, `/services/${p.id}`).expect(200)).body as ServiceDto;
    expect(svc).toMatchObject({ acceptsPayments: true, canManagePay: false, category: 'fuel' });
  });

  it('the payTag is shown to admins and the owner only; rotating it retires the old one (audited)', async () => {
    const owner = await seasoned(t);
    const stranger = await createUser(t);
    const a = await admin(t);
    const p = await seedPoint({ ownerId: owner.id });
    await get(stranger, `/pay/points/${p.id}/manage`).expect(403);
    const mine = (await get(owner, `/pay/points/${p.id}/manage`).expect(200)).body as PayPointManageDto;
    expect(mine).toMatchObject({ payTag: p.tag, payUrl: `http://localhost:3000/pay/t/${p.tag}`, ownerId: owner.id, canRotate: false });
    await send(owner, 'post', `/admin/services/${p.id}/pay-tag/rotate`, { note: 'new sticker' }).expect(403);

    await send(a, 'post', `/admin/services/${p.id}/pay-tag/rotate`, {}).expect(400);
    const rotated = (await send(a, 'post', `/admin/services/${p.id}/pay-tag/rotate`, { note: 'Sticker was copied' }).expect(200)).body as PayPointManageDto;
    expect(rotated.payTag).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(rotated.payTag).not.toBe(p.tag);
    expect(rotated.canRotate).toBe(true);
    await get(stranger, `/pay/t/${p.tag}`).expect(404);
    await get(stranger, `/pay/t/${rotated.payTag}`).expect(200);
    const audit = await t.prisma.adminAction.findFirstOrThrow({ where: { adminId: a.id, action: 'pay.tag_rotate' } });
    expect(audit).toMatchObject({ targetType: 'service', targetId: p.id, targetUserId: owner.id, note: 'Sticker was copied' });
  });

  it('admin partner toggle issues a tag on first enable; only verified services; owner must exist', async () => {
    const a = await admin(t);
    const owner = await seasoned(t);
    const id = newId();
    await t.prisma.$executeRaw`
      INSERT INTO service_centers (id, name, category, address, location, status, qr_secret, updated_at)
      VALUES (${id}::uuid, 'GT Oil', 'repair'::"ServiceCategory", 'ул. Жандосова, 140',
              ST_SetSRID(ST_MakePoint(76.86::float8, 43.21::float8), 4326)::geography, 'verified'::"ServiceStatus", 'x', now())`;
    await send(a, 'put', `/admin/services/${id}/partner`, { acceptsPayments: true }).expect(400);
    await send(a, 'put', `/admin/services/${id}/partner`, { acceptsPayments: true, ownerId: newId(), note: 'partner deal' }).expect(404);
    const on = (await send(a, 'put', `/admin/services/${id}/partner`, { acceptsPayments: true, ownerId: owner.id, note: 'Partner deal #12' }).expect(200)).body as PayPointManageDto;
    expect(on).toMatchObject({ acceptsPayments: true, ownerId: owner.id, items: [] });
    expect(on.payTag).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const off = (await send(a, 'put', `/admin/services/${id}/partner`, { acceptsPayments: false, note: 'Paused' }).expect(200)).body as PayPointManageDto;
    expect(off).toMatchObject({ acceptsPayments: false, ownerId: owner.id, payTag: on.payTag });
    expect(await t.prisma.adminAction.count({ where: { adminId: a.id, action: 'pay.partner', targetId: id } })).toBe(2);

    const pending = await seedPoint({ status: 'pending', accepts: false });
    expect((await send(a, 'put', `/admin/services/${pending.id}/partner`, { acceptsPayments: true, note: 'try it' }).expect(409)).body.error.code).toBe('SERVICE_NOT_VERIFIED');
    const user = await createUser(t);
    await send(user, 'put', `/admin/services/${id}/partner`, { acceptsPayments: true, note: 'nope nope' }).expect(403);
  });

  it('owner and admin manage the price list; admins need a note (audited); others are refused', async () => {
    const owner = await seasoned(t);
    const a = await admin(t);
    const stranger = await createUser(t);
    const p = await seedPoint({ ownerId: owner.id, items: [{ name: 'Замена масла', priceCoins: 18_000, unit: 'service' }] });
    const items = [
      { id: p.items['Замена масла'], name: 'Замена масла 5W-30 (4 л)', priceCoins: 18_000, unit: 'service' },
      { name: 'Масляный фильтр', priceCoins: 3_500, unit: 'pcs' },
    ];
    await send(stranger, 'put', `/pay/points/${p.id}/items`, { items }).expect(403);
    const updated = (await send(owner, 'put', `/pay/points/${p.id}/items`, { items }).expect(200)).body as PayPointManageDto;
    expect(updated.items.map((i) => i.name)).toEqual(['Замена масла 5W-30 (4 л)', 'Масляный фильтр']);
    expect(updated.items[0]!.id).toBe(p.items['Замена масла']);
    await send(owner, 'put', `/pay/points/${p.id}/items`, { items: [{ id: newId(), name: 'x2', priceCoins: 1, unit: 'pcs' }] }).expect(400);

    await send(a, 'put', `/pay/points/${p.id}/items`, { items: [] }).expect(400);
    const cleared = (await send(a, 'put', `/pay/points/${p.id}/items`, { items: [items[1]], note: 'Price list from the contract' }).expect(200)).body as PayPointManageDto;
    expect(cleared.items).toHaveLength(1);
    expect(await t.prisma.adminAction.count({ where: { adminId: a.id, action: 'pay.items', targetId: p.id } })).toBe(1);
  });
});

describe('POST /pay/orders with coins', () => {
  it('prices on the server: 5 l of АИ-95 = 1 225; client prices are ignored; credits the owner (sale)', async () => {
    const owner = await seasoned(t);
    const buyer = await seasoned(t);
    await fund(t, buyer.id, 2000);
    const p = await seedPoint({ ownerId: owner.id });
    const res = await buy(buyer, { serviceId: p.id, items: [{ itemId: p.items['АИ-95'], qty: 5, priceCoins: 1, totalCoins: 1 }], total: 5 }).expect(201);
    const r = res.body as PayReceiptDto;
    expect(r).toMatchObject({ total: 1225, method: 'coins', balanceAfter: 775, card: null, demo: true, point: { serviceId: p.id, category: 'fuel' } });
    expect(r.items).toEqual([{ itemId: p.items['АИ-95'], name: 'АИ-95', unit: 'l', qty: 5, priceCoins: 245, totalCoins: 1225 }]);
    expect(await balanceOf(t, buyer.id)).toBe(775);
    expect(await balanceOf(t, owner.id)).toBe(1225);
    const rows = await t.prisma.walletTransaction.findMany({ where: { ref: r.orderId }, orderBy: { kind: 'asc' } });
    expect(rows.map((x) => [x.kind, Number(x.amount), x.userId])).toEqual([
      ['purchase', -1225, buyer.id],
      ['sale', 1225, owner.id],
    ]);
    expect(await ledgerConsistent(t, buyer.id)).toBe(true);
    expect(await ledgerConsistent(t, owner.id)).toBe(true);
    const n = await t.prisma.notification.findFirstOrThrow({ where: { userId: buyer.id, type: 'purchase_paid' } });
    expect(n.payload).toMatchObject({ orderId: r.orderId, total: 1225, method: 'coins' });
    // Wallet history shows the purchase; my orders list and the receipt read back.
    const ledger = (await get(buyer, '/wallet/transactions?kind=purchase').expect(200)).body as Paginated<{ kind: string; note: string }>;
    expect(ledger.items[0]).toMatchObject({ kind: 'purchase', note: expect.stringContaining('АЗС') });
    const list = (await get(buyer, '/pay/orders').expect(200)).body as Paginated<PayReceiptDto>;
    expect(list.items[0]).toEqual(r);
    expect((await get(buyer, `/pay/orders/${r.orderId}`).expect(200)).body).toEqual(r);
    await get(owner, `/pay/orders/${r.orderId}`).expect(404);
  });

  it('decimal liters and several lines; a point without an owner records a merchant settlement', async () => {
    const buyer = await seasoned(t);
    await fund(t, buyer.id, 10_000);
    const p = await seedPoint();
    const r = (await buy(buyer, { serviceId: p.id, items: [{ itemId: p.items['АИ-92'], qty: 12.5 }, { itemId: p.items['ДТ'], qty: 2 }] }).expect(201)).body as PayReceiptDto;
    expect(r.total).toBe(Math.round(205 * 12.5) + 580);
    const settlement = await t.prisma.merchantSettlement.findUniqueOrThrow({ where: { orderId: r.orderId } });
    expect(settlement).toMatchObject({ serviceId: p.id, amount: r.total, status: 'pending' });
    expect(await t.prisma.walletTransaction.count({ where: { ref: r.orderId } })).toBe(1);
  });

  it('a free amount works too; bad items, quantities and limits are refused', async () => {
    const buyer = await seasoned(t);
    await fund(t, buyer.id, 5000);
    const p = await seedPoint({ items: [{ name: 'АИ-95', priceCoins: 245, unit: 'l' }, { name: 'Фильтр', priceCoins: 3500, unit: 'pcs' }] });
    const other = await seedPoint();
    expect((await buy(buyer, { serviceId: p.id, amount: 3000 }).expect(201)).body).toMatchObject({ total: 3000, items: [{ itemId: null, name: null, qty: 1, totalCoins: 3000 }] });
    expect((await buy(buyer, { serviceId: p.id, items: [{ itemId: other.items['АИ-95'], qty: 1 }] }).expect(400)).body.error.code).toBe('INVALID_ITEM');
    expect((await buy(buyer, { serviceId: p.id, items: [{ itemId: p.items['АИ-95'], qty: 1.25 }] }).expect(400)).body.error.code).toBe('INVALID_QTY');
    expect((await buy(buyer, { serviceId: p.id, items: [{ itemId: p.items['Фильтр'], qty: 1.5 }] }).expect(400)).body.error.code).toBe('INVALID_QTY');
    await buy(buyer, { serviceId: p.id, amount: 0 }).expect(400);
    await buy(buyer, { serviceId: p.id }).expect(400);
    await buy(buyer, { serviceId: newId(), amount: 100 }).expect(404);
    expect(await balanceOf(t, buyer.id)).toBe(2000);
  });

  it('insufficient funds → 409 with the balance; nothing is written', async () => {
    const buyer = await seasoned(t);
    await fund(t, buyer.id, 1000);
    const p = await seedPoint();
    const res = await buy(buyer, { serviceId: p.id, items: [{ itemId: p.items['АИ-95'], qty: 5 }] }).expect(409);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_FUNDS', details: { balance: 1000, total: 1225 } });
    expect(await balanceOf(t, buyer.id)).toBe(1000);
    expect(await t.prisma.payOrder.count({ where: { userId: buyer.id } })).toBe(0);
  });

  it('wallet gates: frozen buyer → 403 WALLET_FROZEN; frozen owner → 409 POINT_UNAVAILABLE; own point → 400', async () => {
    const buyer = await seasoned(t);
    const owner = await seasoned(t);
    await fund(t, buyer.id, 5000);
    await fund(t, owner.id, 5000);
    const p = await seedPoint({ ownerId: owner.id });
    await t.prisma.wallet.update({ where: { userId: owner.id }, data: { frozen: true } });
    expect((await buy(buyer, { serviceId: p.id, amount: 100 }).expect(409)).body.error.code).toBe('POINT_UNAVAILABLE');
    await t.prisma.wallet.update({ where: { userId: owner.id }, data: { frozen: false } });
    expect((await buy(owner, { serviceId: p.id, amount: 100 }).expect(400)).body.error.code).toBe('INVALID_TARGET');
    await t.prisma.wallet.update({ where: { userId: buyer.id }, data: { frozen: true } });
    expect((await buy(buyer, { serviceId: p.id, amount: 100 }).expect(403)).body.error.code).toBe('WALLET_FROZEN');
    expect(await balanceOf(t, buyer.id)).toBe(5000);
  });

  it('debits exactly once under concurrency: same key replays, different keys never overdraw', async () => {
    const buyer = await seasoned(t);
    await fund(t, buyer.id, 2000);
    const p = await seedPoint();
    const body = { serviceId: p.id, method: 'coins', idempotencyKey: key(), items: [{ itemId: p.items['АИ-95'], qty: 5 }] };
    const same = await Promise.all(Array.from({ length: 8 }, () => send(buyer, 'post', '/pay/orders', body)));
    expect(same.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(same.map((r) => (r.body as PayReceiptDto).orderId)).size).toBe(1);
    expect(await balanceOf(t, buyer.id)).toBe(775);
    // A replay later (even after the price changed) answers with the original receipt; a different basket → 409.
    await t.prisma.payItem.update({ where: { id: p.items['АИ-95']! }, data: { priceCoins: 1 } });
    expect(((await send(buyer, 'post', '/pay/orders', body).expect(200)).body as PayReceiptDto).total).toBe(1225);
    expect((await send(buyer, 'post', '/pay/orders', { ...body, items: [{ itemId: p.items['АИ-95'], qty: 6 }] }).expect(409)).body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    await t.prisma.payItem.update({ where: { id: p.items['АИ-95']! }, data: { priceCoins: 245 } });

    // 775 left: of six concurrent 500-coin orders with different keys, exactly one fits.
    await t.redis.flushdb(); // fresh rate-limit window
    const many = await Promise.all(Array.from({ length: 6 }, () => buy(buyer, { serviceId: p.id, amount: 500 })));
    expect(many.filter((r) => r.status === 201)).toHaveLength(1);
    expect(many.filter((r) => r.status === 409).every((r) => r.body.error.code === 'INSUFFICIENT_FUNDS')).toBe(true);
    expect(await balanceOf(t, buyer.id)).toBe(275);
    expect(await t.prisma.walletTransaction.count({ where: { userId: buyer.id, kind: 'purchase' } })).toBe(2);
    expect(await ledgerConsistent(t, buyer.id)).toBe(true);
  });

  it('is rate limited (10 orders per minute)', async () => {
    const buyer = await seasoned(t);
    await fund(t, buyer.id, 5000);
    const p = await seedPoint();
    for (let i = 0; i < 10; i++) await buy(buyer, { serviceId: p.id, amount: 10 }).expect(201);
    expect((await buy(buyer, { serviceId: p.id, amount: 10 }).expect(429)).body.error.code).toBe('RATE_LIMITED');
  });
});

describe('POST /pay/orders with Google Pay (TEST)', () => {
  it('a TEST token pays through the demo provider: top-up + purchase, the coin balance does not move', async () => {
    const buyer = await createUser(t);
    const owner = await seasoned(t);
    const p = await seedPoint({ ownerId: owner.id, items: [{ name: 'Замена масла + фильтр', priceCoins: 20_000, unit: 'service' }] });
    const r = (
      await send(buyer, 'post', '/pay/orders', { serviceId: p.id, method: 'google_pay', googlePay: GPAY, idempotencyKey: key(), items: [{ itemId: p.items['Замена масла + фильтр'], qty: 1 }] }).expect(201)
    ).body as PayReceiptDto;
    expect(r).toMatchObject({ total: 20_000, method: 'google_pay', balanceAfter: null, card: { network: 'VISA', last4: '1111' } });
    expect(await balanceOf(t, buyer.id)).toBe(0);
    expect(await balanceOf(t, owner.id)).toBe(20_000);
    const rows = await t.prisma.walletTransaction.findMany({ where: { userId: buyer.id }, orderBy: { seq: 'asc' } });
    expect(rows.map((x) => [x.kind, Number(x.amount), Number(x.balanceAfter)])).toEqual([
      ['topup', 20_000, 20_000],
      ['purchase', -20_000, 0],
    ]);
    const topup = await t.prisma.topup.findFirstOrThrow({ where: { userId: buyer.id } });
    expect(topup).toMatchObject({ status: 'succeeded', provider: 'demo', amount: 20_000, cardLast4: '1111' });
    expect(await ledgerConsistent(t, buyer.id)).toBe(true);
  });

  it('a token that is not a TEST token is declined (402); the token is required', async () => {
    const buyer = await createUser(t);
    const p = await seedPoint();
    const base = { serviceId: p.id, method: 'google_pay', idempotencyKey: key(), amount: 1000 };
    expect((await send(buyer, 'post', '/pay/orders', { ...base, googlePay: { token: 'tok_live_real_card' } }).expect(402)).body.error.code).toBe('PAYMENT_DECLINED');
    await send(buyer, 'post', '/pay/orders', base).expect(400);
    expect(await t.prisma.payOrder.count({ where: { userId: buyer.id } })).toBe(0);
    expect(await t.prisma.walletTransaction.count({ where: { userId: buyer.id } })).toBe(0);
  });
});
