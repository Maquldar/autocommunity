'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useErrorMessage } from '@/hooks/use-error-message';
import { walletError } from './format';

/** Wallet, transfer, checkout and premium errors → friendly text (`wallet.errors.*`, else the shared mapping). */
export function useWalletErrorMessage(): (error: unknown) => string {
  const t = useTranslations('wallet.errors');
  const generic = useErrorMessage();
  return useCallback(
    (error: unknown) => {
      const mapped = walletError(error);
      return mapped ? t(mapped.key, mapped.values) : generic(error);
    },
    [t, generic],
  );
}
