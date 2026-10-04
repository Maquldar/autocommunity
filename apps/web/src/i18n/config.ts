import { LOCALES, type Locale } from '@autoc/shared';

export const locales = LOCALES;
export const defaultLocale: Locale = 'ru';
/** Cookie read by `src/i18n/request.ts`; written by the language switcher. */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

export type { Locale };
