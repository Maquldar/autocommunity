import { describe, expect, it } from 'vitest';
import { guardRedirect } from './auth/guards';
import { loginUrl, safeNextPath } from './routes';

describe('safeNextPath', () => {
  it.each([
    ['/settings', '/settings'],
    ['/u/123?tab=cars', '/u/123?tab=cars'],
    ['//evil.example', null],
    ['/\\evil.example', null],
    ['https://evil.example', null],
    ['/login', null],
    ['/onboarding', null],
    [null, null],
  ])('%s → %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it('builds login URLs', () => {
    expect(loginUrl('/profile')).toBe('/login?next=%2Fprofile');
    expect(loginUrl('//evil')).toBe('/login');
  });
});

describe('guardRedirect', () => {
  it('sends users who have not finished onboarding there, and finished users away from it', () => {
    expect(guardRedirect('app', { onboardingCompleted: false })).toBe('/onboarding');
    expect(guardRedirect('app', { onboardingCompleted: true })).toBeNull();
    expect(guardRedirect('onboarding', { onboardingCompleted: true })).toBe('/profile');
    expect(guardRedirect('onboarding', { onboardingCompleted: false })).toBeNull();
  });
});
