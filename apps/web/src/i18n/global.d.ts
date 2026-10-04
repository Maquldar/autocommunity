import type { Locale } from '@autoc/shared';
import type messages from '../../messages/en.json';

// Type-safe message keys: `t('nav.mapp')` is a compile error. en.json is the reference catalog;
// ru.json must have the same keys (checked by src/i18n/messages.test.ts).
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
