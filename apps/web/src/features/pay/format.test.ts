import { describe, expect, it } from 'vitest';
import { cartTotal, formatQty, parseQty, pointInitials, stepQty } from './format';

const fuel = { id: 'i', name: 'АИ-95', priceCoins: 245, unit: 'l' as const };

describe('pay format', () => {
  it('quantities, initials and totals', () => {
    expect(formatQty(12.5, 'ru')).toBe('12,5');
    expect(formatQty(20, 'en')).toBe('20');
    expect(parseQty('12,5')).toBe(12.5);
    expect(parseQty('')).toBeNull();
    expect(parseQty('abc')).toBeNaN();
    expect(pointInitials('GT Oil Service')).toBe('GO');
    expect(pointInitials('RP')).toBe('RP');
    expect(cartTotal({ item: fuel, qty: 5 })).toBe(1225);
    expect(cartTotal({ item: fuel, qty: 20 })).toBe(4900);
    expect(cartTotal({ item: fuel, qty: 1.25 })).toBeNull();
    expect(cartTotal(null)).toBeNull();
    expect(stepQty('l', 20, 1)).toBe(21);
    expect(stepQty('l', 1, -1)).toBe(1);
    expect(stepQty('service', 20, 1)).toBe(20);
  });
});
