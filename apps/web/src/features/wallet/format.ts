import { DEMO_TEST_CARD, PREMIUM, WALLET_LIMITS, type PremiumDto, type WalletTxKind } from '@autoc/shared';
import { getRetryAfterSec, isApiError, numberDetail } from '@/lib/api/errors';

/* ---------- coins ---------- */

/** "1 490" (ru) / "1,490" (en): coins are whole numbers. */
export function formatCoins(amount: number, locale = 'ru'): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(amount));
}

/** "+500" / "−1 490" / "0" with a typographic minus, for ledger rows. */
export function formatSignedCoins(amount: number, locale = 'ru'): string {
  const rounded = Math.round(amount);
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : '−'}${formatCoins(Math.abs(rounded), locale)}`;
}

/* ---------- amounts ---------- */

export const TOPUP_PRESETS = [1_000, 2_000, 5_000, 10_000] as const;
export const TRANSFER_PRESETS = [500, 1_000, 2_000, 5_000] as const;

export type AmountError = 'required' | 'notWhole' | 'tooSmall' | 'tooLarge' | 'overBalance' | 'overDaily';
export type AmountCheck = { ok: true; value: number } | { ok: false; error: AmountError };

/** Digits only, spaces/NBSP/thin spaces ignored ("10 000" → 10000). */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[\s  ]/g, '');
  if (!cleaned) return null;
  if (!/^\d+([.,]\d+)?$/.test(cleaned)) return Number.NaN;
  return Number(cleaned.replace(',', '.'));
}

export function checkAmount(text: string, { min, max, balance }: { min: number; max: number; balance?: number }): AmountCheck {
  const value = parseAmount(text);
  if (value === null) return { ok: false, error: 'required' };
  if (!Number.isFinite(value) || !Number.isInteger(value)) return { ok: false, error: 'notWhole' };
  if (value < min) return { ok: false, error: 'tooSmall' };
  if (value > max) return { ok: false, error: 'tooLarge' };
  if (balance !== undefined && value > balance) return { ok: false, error: 'overBalance' };
  return { ok: true, value };
}

export const checkTopupAmount = (text: string) => checkAmount(text, { min: WALLET_LIMITS.topupMin, max: WALLET_LIMITS.topupMax });

/** Transfers are capped by the per-transfer max and by what is left of today's cap. */
export function checkTransferAmount(text: string, { balance, dailyRemaining }: { balance: number; dailyRemaining: number }): AmountCheck {
  const result = checkAmount(text, { min: WALLET_LIMITS.transferMin, max: WALLET_LIMITS.transferMax });
  if (!result.ok) return result;
  // Over what is left of today's cap reads as a cap problem, not "too large" in general.
  if (result.value > Math.max(0, dailyRemaining)) return { ok: false, error: 'overDaily' };
  if (result.value > balance) return { ok: false, error: 'overBalance' };
  return result;
}

/* ---------- idempotency ---------- */

/** 8–64 chars `[A-Za-z0-9_-]` (API.md §9.1). One per transfer dialog, so a retried send never pays twice. */
export function newIdempotencyKey(random: () => number = Math.random): string {
  const uuid = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : null;
  if (uuid) return `tr_${uuid}`;
  let out = 'tr_';
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 24; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

/* ---------- demo card ---------- */

export const cardDigits = (text: string) => text.replace(/\D/g, '');

/** "4242424242424242" → "4242 4242 4242 4242" (max 19 digits). */
export function formatCardNumber(text: string): string {
  return cardDigits(text)
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** "1228" → "12/28" while typing. */
export function formatExpiry(text: string): string {
  const d = cardDigits(text).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

export type CardErrors = { number?: 'required' | 'invalid'; expiry?: 'invalid' | 'past'; cvc?: 'invalid' };

/** Client-side checks for the demo card form (the server decides succeeded / declined by the number). */
export function checkCard(input: { number: string; expiry: string; cvc: string }, now = new Date()): CardErrors {
  const errors: CardErrors = {};
  const digits = cardDigits(input.number);
  if (!digits) errors.number = 'required';
  else if (digits.length < 12 || digits.length > 19) errors.number = 'invalid';
  if (input.expiry) {
    const m = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(input.expiry.trim());
    if (!m) errors.expiry = 'invalid';
    else {
      const year = 2000 + Number(m[2]);
      const month = Number(m[1]);
      if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) errors.expiry = 'past';
    }
  }
  if (input.cvc && !/^\d{3,4}$/.test(input.cvc.trim())) errors.cvc = 'invalid';
  return errors;
}

export const isTestCard = (text: string) => cardDigits(text) === DEMO_TEST_CARD;

/* ---------- ledger ---------- */

export const TX_FILTERS = ['all', 'topup', 'purchase', 'transfer_in', 'transfer_out', 'subscription', 'admin_adjust'] as const;
export type TxFilter = (typeof TX_FILTERS)[number];

/** UI filter → API `kind` (`all` → no filter). */
export function filterKind(filter: TxFilter): WalletTxKind | undefined {
  return filter === 'all' ? undefined : filter;
}

/* ---------- premium ---------- */

export type PremiumView = {
  active: boolean;
  /** Subscribed, renews automatically. */
  renewing: boolean;
  /** Subscribed with auto-renew off: ends at `periodEnd`. */
  ending: boolean;
  periodEnd: string | null;
  price: number;
  canSubscribe: boolean;
  /** Coins missing for one period (0 when the balance covers it). */
  shortBy: number;
};

export function premiumView(premium: PremiumDto, balance: number): PremiumView {
  const price = premium.priceCoins || PREMIUM.priceCoins;
  const active = premium.isPremium && premium.status !== 'none';
  return {
    active,
    renewing: active && premium.status === 'active' && premium.autoRenew,
    ending: active && (premium.status === 'cancelled' || !premium.autoRenew),
    periodEnd: premium.currentPeriodEnd,
    price,
    canSubscribe: !active && balance >= price,
    shortBy: Math.max(0, price - balance),
  };
}

/* ---------- errors ---------- */

export type WalletErrorKey =
  | 'insufficientFunds'
  | 'walletFrozen'
  | 'recipientUnavailable'
  | 'recipientNotFound'
  | 'self'
  | 'dailyCap'
  | 'keyReused'
  | 'accountTooNew'
  | 'ratingTooLow'
  | 'rateLimited'
  | 'declined'
  | 'topupNotPending'
  | 'topupExpired'
  | 'alreadyPremium'
  | 'notPremium'
  | 'validation';

export type WalletError = { key: WalletErrorKey; values?: Record<string, number> };

/** Wallet / transfer / top-up / premium errors → `wallet.errors.*` (null → use the generic mapping). */
export function walletError(error: unknown): WalletError | null {
  if (!isApiError(error)) return null;
  switch (error.code) {
    case 'INSUFFICIENT_FUNDS':
      return { key: 'insufficientFunds', values: { balance: numberDetail(error, 'balance') ?? 0 } };
    case 'WALLET_FROZEN':
      return { key: 'walletFrozen' };
    case 'RECIPIENT_UNAVAILABLE':
      return { key: 'recipientUnavailable' };
    case 'NOT_FOUND':
      return { key: 'recipientNotFound' };
    case 'INVALID_TARGET':
      return { key: 'self' };
    case 'TRANSFER_DAILY_CAP':
      return { key: 'dailyCap', values: { cap: numberDetail(error, 'cap') ?? WALLET_LIMITS.transferDailyCap, remaining: numberDetail(error, 'remaining') ?? 0 } };
    case 'IDEMPOTENCY_KEY_REUSED':
      return { key: 'keyReused' };
    case 'ACCOUNT_TOO_NEW': {
      const sec = numberDetail(error, 'retryAfterSec');
      return { key: 'accountTooNew', values: { hours: sec === null ? WALLET_LIMITS.transferMinAccountAgeHours : Math.max(1, Math.ceil(sec / 3600)) } };
    }
    case 'RATING_TOO_LOW':
      return { key: 'ratingTooLow', values: { min: numberDetail(error, 'min') ?? WALLET_LIMITS.transferMinRating } };
    case 'RATE_LIMITED': {
      const sec = getRetryAfterSec(error);
      return { key: 'rateLimited', values: { minutes: sec === null ? 1 : Math.max(1, Math.ceil(sec / 60)) } };
    }
    case 'PAYMENT_DECLINED':
      return { key: 'declined' };
    case 'TOPUP_NOT_PENDING':
      return { key: 'topupNotPending' };
    case 'TOPUP_EXPIRED':
      return { key: 'topupExpired' };
    case 'ALREADY_PREMIUM':
      return { key: 'alreadyPremium' };
    case 'NOT_PREMIUM':
      return { key: 'notPremium' };
    case 'VALIDATION_ERROR':
      return { key: 'validation' };
    default:
      return null;
  }
}
