import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import { useErrorMessage } from '@/hooks/use-error-message';
import { describeError } from './error-messages';
import { ApiError } from './errors';

const err = (code: string, status = 400, details?: unknown) => new ApiError({ status, code, message: 'server text', details });

describe('describeError', () => {
  it.each([
    [err('OTP_INVALID', 400, { attemptsLeft: 2 }), { key: 'otpInvalid', values: { attemptsLeft: 2 } }],
    [err('OTP_EXPIRED'), { key: 'otpExpired' }],
    [err('RATE_LIMITED', 429, { retryAfterSec: 30 }), { key: 'rateLimited', values: { seconds: 30 } }],
    [err('RATE_LIMITED', 429), { key: 'rateLimitedShort' }],
    [err('NICKNAME_TAKEN', 409), { key: 'nicknameTaken' }],
    [err('PHONE_IN_USE', 409), { key: 'phoneInUse' }],
    [err('PHONE_NOT_SUPPORTED'), { key: 'phoneNotSupported' }],
    [err('VEHICLE_LIMIT', 409), { key: 'vehicleLimit', values: { max: 5 } }],
    [err('ONBOARDING_INCOMPLETE', 400, { missing: ['name'] }), { key: 'onboardingIncomplete' }],
    [err('FILE_TOO_LARGE', 413), { key: 'fileTooLarge', values: { maxMb: 10 } }],
    [err('UNSUPPORTED_FILE_TYPE', 415), { key: 'unsupportedFileType' }],
    [err('ACCOUNT_BLOCKED', 403), { key: 'accountBlocked' }],
    [err('SESSION_EXPIRED', 401), { key: 'sessionExpired' }],
    [err('NETWORK_ERROR', 0), { key: 'network' }],
    [err('COMMUNITY_NAME_TAKEN', 409), { key: 'communityNameTaken' }],
    [err('COMMUNITY_LIMIT', 409), { key: 'communityLimit', values: { max: 10 } }],
    [err('MEMBERSHIP_LIMIT', 409), { key: 'membershipLimit', values: { max: 50 } }],
    [err('ALREADY_MEMBER', 409), { key: 'alreadyMember' }],
    [err('OWNER_CANNOT_LEAVE', 400), { key: 'ownerCannotLeave' }],
    [err('INVALID_TARGET', 400), { key: 'invalidTarget' }],
    [err('INVALID_UPLOAD', 400), { key: 'invalidUpload' }],
    [err('SOMETHING_NEW', 503), { key: 'server' }],
    [err('SOMETHING_NEW', 418), { key: 'generic' }],
    [new Error('boom'), { key: 'generic' }],
  ])('%s → %o', (error, expected) => {
    expect(describeError(error)).toEqual(expected);
  });
});

function wrapper(locale: 'en' | 'ru') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : ru} timeZone="Asia/Almaty">
        {children}
      </NextIntlClientProvider>
    );
  };
}

describe('useErrorMessage', () => {
  it('renders localized, pluralized messages', () => {
    const { result } = renderHook(() => useErrorMessage(), { wrapper: wrapper('en') });
    expect(result.current(err('OTP_INVALID', 400, { attemptsLeft: 1 }))).toBe('Wrong code. 1 attempt left.');
    expect(result.current(err('OTP_INVALID', 400, { attemptsLeft: 0 }))).toBe('Wrong code. No attempts left — request a new code.');
    expect(result.current(err('RATE_LIMITED', 429, { retryAfterSec: 45 }))).toBe('Too many attempts. Try again in 45 seconds.');
    expect(result.current(err('NICKNAME_TAKEN', 409))).toBe('This nickname is already taken');
  });

  it('uses Russian plural forms', () => {
    const { result } = renderHook(() => useErrorMessage(), { wrapper: wrapper('ru') });
    expect(result.current(err('OTP_INVALID', 400, { attemptsLeft: 3 }))).toBe('Неверный код. Осталось 3 попытки.');
    expect(result.current(err('VEHICLE_LIMIT', 409))).toBe('Можно добавить не больше 5 машин');
  });
});
