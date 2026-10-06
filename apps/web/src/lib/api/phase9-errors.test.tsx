import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import { useErrorMessage } from '@/hooks/use-error-message';
import { describeError } from './error-messages';
import { ApiError } from './errors';

const err = (code: string, status = 409, details?: unknown) => new ApiError({ status, code, message: 'server text', details });

describe('describeError — phase 9 codes', () => {
  it.each([
    [err('INSUFFICIENT_FUNDS', 409, { balance: 10 }), { key: 'insufficientFunds' }],
    [err('WALLET_FROZEN', 403), { key: 'walletFrozen' }],
    [err('RECIPIENT_UNAVAILABLE'), { key: 'recipientUnavailable' }],
    [err('TRANSFER_DAILY_CAP', 409, { cap: 100000, remaining: 300 }), { key: 'transferDailyCap', values: { remaining: 300 } }],
    [err('IDEMPOTENCY_KEY_REUSED'), { key: 'idempotencyKeyReused' }],
    [err('ACCOUNT_TOO_NEW', 403), { key: 'accountTooNew' }],
    [err('TOPUP_NOT_PENDING'), { key: 'topupNotPending' }],
    [err('TOPUP_EXPIRED'), { key: 'topupExpired' }],
    [err('PAYMENT_DECLINED', 402), { key: 'paymentDeclined' }],
    [err('ALREADY_PREMIUM'), { key: 'alreadyPremium' }],
    [err('NOT_PREMIUM'), { key: 'notPremium' }],
    [err('WALLET_ALREADY_FROZEN'), { key: 'walletAlreadyFrozen' }],
    [err('WALLET_NOT_FROZEN'), { key: 'walletNotFrozen' }],
    [err('ALREADY_VOTED'), { key: 'alreadyVoted' }],
    [err('MEDIA_LIMIT', 400, { limit: 6, premiumLimit: 12 }), { key: 'mediaLimit', values: { max: 6 } }],
    [err('VIOLATION_INVALID_STATE'), { key: 'violationInvalidState' }],
    [err('ALREADY_DISPUTED'), { key: 'alreadyDisputed' }],
    [err('RATING_TOO_LOW', 403, { min: 40 }), { key: 'ratingTooLow', values: { min: 40 } }],
    // Limit errors now carry the limit that applied (10 for a premium user).
    [err('VEHICLE_LIMIT', 409, { limit: 10, premiumLimit: 10 }), { key: 'vehicleLimit', values: { max: 10 } }],
    [err('COMMUNITY_LIMIT', 409, { limit: 20, premiumLimit: 20 }), { key: 'communityLimit', values: { max: 20 } }],
    [err('MEMBERSHIP_LIMIT', 409, { limit: 50, premiumLimit: 100 }), { key: 'membershipLimit', values: { max: 50 } }],
  ])('%s', (error, expected) => {
    expect(describeError(error)).toEqual(expected);
  });

  const wrapper = (locale: 'en' | 'ru') =>
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : ru} timeZone="Asia/Almaty">
          {children}
        </NextIntlClientProvider>
      );
    };

  it('formats in both languages', () => {
    const { result } = renderHook(() => useErrorMessage(), { wrapper: wrapper('ru') });
    expect(result.current(err('MEDIA_LIMIT', 400, { limit: 6, premiumLimit: 12 }))).toBe('Можно прикрепить до 6 фото.');
    expect(result.current(err('WALLET_FROZEN', 403))).toMatch(/Кошелёк заморожен/);
    const en_ = renderHook(() => useErrorMessage(), { wrapper: wrapper('en') }).result;
    expect(en_.current(err('RATING_TOO_LOW', 403, { min: 30 }))).toBe('You need a trust rating of at least 30 for this.');
  });
});
