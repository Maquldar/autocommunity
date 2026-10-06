'use client';

import { FEED_LIMITS } from '@autoc/shared';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useErrorMessage } from '@/hooks/use-error-message';
import { isApiError } from '@/lib/api/errors';

/** Phase 8 feed error codes → `feed.errors.*`; everything else uses the shared mapping. */
export function useFeedErrorMessage(): (error: unknown) => string {
  const t = useTranslations('feed.errors');
  const generic = useErrorMessage();
  return useCallback(
    (error: unknown) => {
      if (isApiError(error)) {
        switch (error.code) {
          case 'ALREADY_VOTED':
            return t('alreadyVoted');
          case 'INVALID_OPTION':
            return t('invalidOption');
          case 'ALREADY_REPORTED':
            return t('alreadyReported');
          case 'RATE_LIMITED':
            return t('rateLimited', { posts: FEED_LIMITS.postsPerDay, comments: FEED_LIMITS.commentsPerHour });
        }
      }
      return generic(error);
    },
    [t, generic],
  );
}
