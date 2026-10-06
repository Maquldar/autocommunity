'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useErrorMessage } from '@/hooks/use-error-message';
import { isApiError } from '@/lib/api/errors';

/** Phase 8 event error codes → `events.errors.*`; everything else uses the shared mapping. */
export function useEventErrorMessage(): (error: unknown) => string {
  const t = useTranslations('events.errors');
  const generic = useErrorMessage();
  return useCallback(
    (error: unknown) => {
      if (isApiError(error)) {
        if (error.code === 'EVENT_FULL') return t('full');
        if (error.code === 'EVENT_ENDED') return t('ended');
      }
      return generic(error);
    },
    [t, generic],
  );
}
