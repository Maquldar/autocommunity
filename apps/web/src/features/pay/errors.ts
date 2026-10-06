'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { numberDetail, isApiError } from '@/lib/api/errors';
import { useWalletErrorMessage } from '@/features/wallet/errors';

const PAY_CODES = ['POINT_UNAVAILABLE', 'INVALID_ITEM', 'INVALID_QTY', 'ORDER_LIMIT', 'NOT_FOUND', 'PAYMENT_DECLINED', 'INSUFFICIENT_FUNDS'] as const;
type PayCode = (typeof PAY_CODES)[number];
const KEY: Record<PayCode, string> = {
  POINT_UNAVAILABLE: 'pointUnavailable',
  INVALID_ITEM: 'invalidItem',
  INVALID_QTY: 'invalidQty',
  ORDER_LIMIT: 'orderLimit',
  NOT_FOUND: 'notFound',
  PAYMENT_DECLINED: 'declined',
  INSUFFICIENT_FUNDS: 'insufficientFunds',
};

/** Order errors → `pay.errors.*`, else the wallet mapping (frozen, rate limit…), else the generic one. */
export function usePayErrorMessage(): (error: unknown) => string {
  const t = useTranslations('pay.errors');
  const wallet = useWalletErrorMessage();
  return useCallback(
    (error: unknown) => {
      if (isApiError(error) && (PAY_CODES as readonly string[]).includes(error.code)) {
        return t(KEY[error.code as PayCode] as 'declined', { balance: numberDetail(error, 'balance') ?? 0, max: numberDetail(error, 'max') ?? 0 });
      }
      return wallet(error);
    },
    [t, wallet],
  );
}
