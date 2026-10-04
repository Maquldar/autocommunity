'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { describeError } from '@/lib/api/error-messages';

/** `(error) => localized message` for any thrown value (ApiError codes → `errors.*`). */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations('errors');
  return useCallback(
    (error: unknown) => {
      const { key, values } = describeError(error);
      return t(key, values);
    },
    [t],
  );
}
