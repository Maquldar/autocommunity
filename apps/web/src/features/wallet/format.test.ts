import { DEMO_TEST_CARD, type PremiumDto } from '@autoc/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import {
  cardDigits,
  checkAmount,
  checkCard,
  checkTopupAmount,
  checkTransferAmount,
  filterKind,
  formatCardNumber,
  formatCoins,
  formatExpiry,
  formatSignedCoins,
  IDEMPOTENCY_KEY_RE,
  isTestCard,
  newIdempotencyKey,
  parseAmount,
  premiumView,
  walletError,
} from './format';

const err = (code: string, status = 409, details?: unknown) => new ApiError({ status, code, message: code, details });

const premium = (over: Partial<PremiumDto> = {}): PremiumDto => ({
  status: 'none',
  isPremium: false,
  autoRenew: false,
  startedAt: null,
  currentPeriodEnd: null,
  priceCoins: 1490,
  periodDays: 30,
  limits: { vehicles: 5, postMedia: 6, communitiesOwned: 10, communityMemberships: 50 },
  ...over,
});

describe('coins formatting', () => {
  it('groups thousands per locale and signs ledger amounts', () => {
    expect(formatCoins(1490, 'en')).toBe('1,490');
    expect(formatCoins(200000, 'ru').replace(/\s/g, ' ')).toBe('200 000');
    expect(formatSignedCoins(500, 'en')).toBe('+500');
    expect(formatSignedCoins(-1490, 'en')).toBe('−1,490');
    expect(formatSignedCoins(0)).toBe('0');
  });
});

describe('amounts', () => {
  it('parses whole amounts with spaces', () => {
    expect(parseAmount('10 000')).toBe(10000);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('12,5')).toBe(12.5);
    expect(Number.isNaN(parseAmount('abc'))).toBe(true);
  });
  it('checks top-ups against 500..200 000', () => {
    expect(checkTopupAmount('')).toEqual({ ok: false, error: 'required' });
    expect(checkTopupAmount('499')).toEqual({ ok: false, error: 'tooSmall' });
    expect(checkTopupAmount('500')).toEqual({ ok: true, value: 500 });
    expect(checkTopupAmount('200 000')).toEqual({ ok: true, value: 200000 });
    expect(checkTopupAmount('200001')).toEqual({ ok: false, error: 'tooLarge' });
    expect(checkTopupAmount('10.5')).toEqual({ ok: false, error: 'notWhole' });
    expect(checkAmount('700', { min: 1, max: 1000, balance: 600 })).toEqual({ ok: false, error: 'overBalance' });
  });
  it('checks transfers against 100..50 000, the balance and what is left of the daily cap', () => {
    const ctx = { balance: 5000, dailyRemaining: 100_000 };
    expect(checkTransferAmount('99', ctx)).toEqual({ ok: false, error: 'tooSmall' });
    expect(checkTransferAmount('50001', { balance: 90000, dailyRemaining: 100000 })).toEqual({ ok: false, error: 'tooLarge' });
    expect(checkTransferAmount('6000', ctx)).toEqual({ ok: false, error: 'overBalance' });
    expect(checkTransferAmount('3000', { balance: 5000, dailyRemaining: 2000 })).toEqual({ ok: false, error: 'overDaily' });
    expect(checkTransferAmount('1 000', ctx)).toEqual({ ok: true, value: 1000 });
  });
});

describe('idempotency key', () => {
  it('matches the contract and differs per call', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(IDEMPOTENCY_KEY_RE);
    expect(a).not.toBe(b);
  });
  it('falls back to a random key without crypto.randomUUID', () => {
    const original = globalThis.crypto.randomUUID;
    try {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
      expect(newIdempotencyKey(() => 0.5)).toMatch(IDEMPOTENCY_KEY_RE);
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});

describe('demo card', () => {
  it('formats the number and expiry while typing', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242');
    expect(formatCardNumber('4242-42')).toBe('4242 42');
    expect(formatExpiry('1228')).toBe('12/28');
    expect(formatExpiry('1')).toBe('1');
    expect(cardDigits('4242 4242')).toBe('42424242');
    expect(isTestCard('4242 4242 4242 4242')).toBe(true);
    expect(isTestCard('4000 0000 0000 0002')).toBe(false);
    expect(cardDigits(formatCardNumber(DEMO_TEST_CARD))).toBe(DEMO_TEST_CARD);
  });
  it('validates the form', () => {
    const now = new Date('2026-10-06T00:00:00Z');
    expect(checkCard({ number: '', expiry: '', cvc: '' }, now)).toEqual({ number: 'required' });
    expect(checkCard({ number: '4242', expiry: '', cvc: '' }, now)).toEqual({ number: 'invalid' });
    expect(checkCard({ number: '4242 4242 4242 4242', expiry: '13/30', cvc: '12' }, now)).toEqual({ expiry: 'invalid', cvc: 'invalid' });
    expect(checkCard({ number: '4242 4242 4242 4242', expiry: '09/26', cvc: '' }, now)).toEqual({ expiry: 'past' });
    expect(checkCard({ number: '4242 4242 4242 4242', expiry: '10/26', cvc: '123' }, now)).toEqual({});
  });
});

describe('ledger filters', () => {
  it('maps UI filters to API kinds', () => {
    expect(filterKind('all')).toBeUndefined();
    expect(filterKind('transfer_in')).toBe('transfer_in');
  });
});

describe('premiumView', () => {
  it('offers subscribing or a top-up', () => {
    expect(premiumView(premium(), 2000)).toMatchObject({ active: false, canSubscribe: true, shortBy: 0 });
    expect(premiumView(premium(), 1000)).toMatchObject({ canSubscribe: false, shortBy: 490 });
  });
  it('tells renewing from ending', () => {
    const end = '2026-11-05T00:00:00Z';
    expect(premiumView(premium({ status: 'active', isPremium: true, autoRenew: true, currentPeriodEnd: end }), 0)).toMatchObject({ active: true, renewing: true, ending: false, periodEnd: end, canSubscribe: false });
    expect(premiumView(premium({ status: 'cancelled', isPremium: true, autoRenew: false, currentPeriodEnd: end }), 0)).toMatchObject({ active: true, renewing: false, ending: true });
  });
});

describe('walletError', () => {
  it.each([
    [err('INSUFFICIENT_FUNDS', 409, { balance: 300 }), { key: 'insufficientFunds', values: { balance: 300 } }],
    [err('WALLET_FROZEN', 403), { key: 'walletFrozen' }],
    [err('RECIPIENT_UNAVAILABLE'), { key: 'recipientUnavailable' }],
    [err('NOT_FOUND', 404), { key: 'recipientNotFound' }],
    [err('INVALID_TARGET', 400), { key: 'self' }],
    [err('TRANSFER_DAILY_CAP', 409, { cap: 100000, remaining: 2500 }), { key: 'dailyCap', values: { cap: 100000, remaining: 2500 } }],
    [err('IDEMPOTENCY_KEY_REUSED'), { key: 'keyReused' }],
    [err('ACCOUNT_TOO_NEW', 403, { minHours: 24, retryAfterSec: 7200 }), { key: 'accountTooNew', values: { hours: 2 } }],
    [err('ACCOUNT_TOO_NEW', 403), { key: 'accountTooNew', values: { hours: 24 } }],
    [err('RATING_TOO_LOW', 403, { min: 30 }), { key: 'ratingTooLow', values: { min: 30 } }],
    [err('RATE_LIMITED', 429, { retryAfterSec: 61 }), { key: 'rateLimited', values: { minutes: 2 } }],
    [err('PAYMENT_DECLINED', 402), { key: 'declined' }],
    [err('TOPUP_NOT_PENDING'), { key: 'topupNotPending' }],
    [err('TOPUP_EXPIRED'), { key: 'topupExpired' }],
    [err('ALREADY_PREMIUM'), { key: 'alreadyPremium' }],
    [err('NOT_PREMIUM'), { key: 'notPremium' }],
    [err('VALIDATION_ERROR', 400), { key: 'validation' }],
  ])('%s', (error, expected) => {
    expect(walletError(error)).toEqual(expected);
  });
  it('leaves other errors to the shared mapping', () => {
    expect(walletError(err('INTERNAL', 500))).toBeNull();
    expect(walletError(new Error('x'))).toBeNull();
  });
});
