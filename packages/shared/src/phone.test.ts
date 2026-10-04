import { describe, expect, it } from 'vitest';
import { maskPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['+7 701 123 45 67', '+77011234567'],
    ['8 (701) 123-45-67', '+77011234567'],
    ['7011234567', '+77011234567'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('%s -> %s', (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each(['', '12345', '+7 701 123', '+0123456789', 'abc'])('rejects %s', (input) =>
    expect(normalizePhone(input)).toBeNull(),
  );
});

describe('maskPhone', () => {
  it('hides the middle digits', () => expect(maskPhone('+77011234567')).toBe('+7 701 *** ** 67'));
});
