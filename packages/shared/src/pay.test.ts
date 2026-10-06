import { describe, expect, it } from 'vitest';
import { createPayOrderSchema, extractPayTag, isValidQty, lineTotal, payTagUrl, putPayItemsSchema } from './pay';

const id = '0192f4a0-0000-7000-8000-000000000001';
const tag = 'Ab3_dE-fGhIjKlMnOpQrSt';

describe('payTag', () => {
  it('builds the sticker URL and reads it back from URLs, bare tags and junk', () => {
    expect(payTagUrl('https://demo.example/', tag)).toBe(`https://demo.example/pay/t/${tag}`);
    expect(extractPayTag(payTagUrl('http://localhost:3600', tag))).toBe(tag);
    expect(extractPayTag(`https://x.kz/pay/t/${tag}/?src=nfc`)).toBe(tag);
    expect(extractPayTag(`  ${tag} `)).toBe(tag);
    expect(extractPayTag('https://x.kz/services/123')).toBeNull();
    expect(extractPayTag('short')).toBeNull();
    expect(extractPayTag('<script>alert(1)</script>')).toBeNull();
    expect(extractPayTag('')).toBeNull();
  });
});

describe('quantities and totals', () => {
  it('liters take one decimal; pieces and services are whole', () => {
    expect(isValidQty('l', 5)).toBe(true);
    expect(isValidQty('l', 12.5)).toBe(true);
    expect(isValidQty('l', 0.05)).toBe(false);
    expect(isValidQty('l', 1.25)).toBe(false);
    expect(isValidQty('l', 201)).toBe(false);
    expect(isValidQty('service', 1)).toBe(true);
    expect(isValidQty('pcs', 1.5)).toBe(false);
    expect(isValidQty('pcs', 21)).toBe(false);
  });

  it('rounds line totals to whole coins', () => {
    expect(lineTotal(245, 5)).toBe(1225);
    expect(lineTotal(245, 20)).toBe(4900);
    expect(lineTotal(245, 12.5)).toBe(3063);
    expect(lineTotal(205, 0.1)).toBe(21);
    expect(lineTotal(18_000, 1)).toBe(18_000);
  });
});

describe('createPayOrderSchema', () => {
  const base = { serviceId: id, method: 'coins', idempotencyKey: 'pay_12345678' };
  it('needs exactly one of items / amount', () => {
    expect(createPayOrderSchema.safeParse({ ...base, items: [{ itemId: id, qty: 5 }] }).success).toBe(true);
    expect(createPayOrderSchema.safeParse({ ...base, amount: 5000 }).success).toBe(true);
    expect(createPayOrderSchema.safeParse(base).success).toBe(false);
    expect(createPayOrderSchema.safeParse({ ...base, amount: 5000, items: [{ itemId: id, qty: 5 }] }).success).toBe(false);
    expect(createPayOrderSchema.safeParse({ ...base, items: [{ itemId: id, qty: 1 }, { itemId: id, qty: 2 }] }).success).toBe(false);
  });
  it('google_pay needs the token; coins must not carry one; client prices are not accepted', () => {
    expect(createPayOrderSchema.safeParse({ ...base, method: 'google_pay', amount: 100 }).success).toBe(false);
    expect(createPayOrderSchema.safeParse({ ...base, method: 'google_pay', amount: 100, googlePay: { token: 'examplePaymentMethodToken', cardNetwork: 'VISA', cardDetails: '1111' } }).success).toBe(true);
    expect(createPayOrderSchema.safeParse({ ...base, amount: 100, googlePay: { token: 'x' } }).success).toBe(false);
    const parsed = createPayOrderSchema.parse({ ...base, items: [{ itemId: id, qty: 5, priceCoins: 1 }] });
    expect(parsed.items![0]).toEqual({ itemId: id, qty: 5 });
  });
});

describe('putPayItemsSchema', () => {
  it('validates names, prices and units', () => {
    expect(putPayItemsSchema.safeParse({ items: [{ name: 'АИ-95', priceCoins: 245, unit: 'l' }] }).success).toBe(true);
    expect(putPayItemsSchema.safeParse({ items: [{ name: 'A', priceCoins: 245, unit: 'l' }] }).success).toBe(false);
    expect(putPayItemsSchema.safeParse({ items: [{ name: 'АИ-95', priceCoins: 0, unit: 'l' }] }).success).toBe(false);
    expect(putPayItemsSchema.safeParse({ items: [{ name: 'АИ-95', priceCoins: 2.5, unit: 'l' }] }).success).toBe(false);
    expect(putPayItemsSchema.safeParse({ items: [{ name: 'АИ-95', priceCoins: 245, unit: 'kg' }] }).success).toBe(false);
    expect(putPayItemsSchema.safeParse({ items: [{ id, name: 'a1', priceCoins: 1, unit: 'l' }, { id, name: 'a2', priceCoins: 1, unit: 'l' }] }).success).toBe(false);
  });
});
