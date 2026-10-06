import { GOOGLE_PAY_TEST } from '@autoc/shared';

/**
 * Google Pay API for Web, TEST environment only (API.md §11). TEST never charges a card: Google returns the
 * example gateway's token, which the API's demo provider accepts.
 */

export const GOOGLE_PAY_SCRIPT = 'https://pay.google.com/gp/p/js/pay.js';

const baseRequest = { apiVersion: 2, apiVersionMinor: 0 } as const;

const cardMethod = {
  type: 'CARD',
  parameters: {
    allowedAuthMethods: [...GOOGLE_PAY_TEST.allowedAuthMethods],
    allowedCardNetworks: [...GOOGLE_PAY_TEST.allowedCardNetworks],
  },
  tokenizationSpecification: {
    type: 'PAYMENT_GATEWAY',
    parameters: { gateway: GOOGLE_PAY_TEST.gateway, gatewayMerchantId: GOOGLE_PAY_TEST.gatewayMerchantId },
  },
} as const;

export const isReadyToPayRequest = () => ({
  ...baseRequest,
  allowedPaymentMethods: [{ type: cardMethod.type, parameters: cardMethod.parameters }],
});

/** `loadPaymentData` request for a total in tenge (1 coin = 1 ₸). */
export function paymentDataRequest(total: number, label: string) {
  return {
    ...baseRequest,
    allowedPaymentMethods: [cardMethod],
    merchantInfo: { merchantName: GOOGLE_PAY_TEST.merchantName },
    transactionInfo: {
      totalPriceStatus: 'FINAL',
      totalPriceLabel: label,
      totalPrice: total.toFixed(2),
      currencyCode: GOOGLE_PAY_TEST.currencyCode,
      countryCode: GOOGLE_PAY_TEST.countryCode,
    },
  };
}

export type GooglePayResult = { token: string; cardNetwork?: string; cardDetails?: string };

type PaymentData = { paymentMethodData?: { tokenizationData?: { token?: string }; info?: { cardNetwork?: string; cardDetails?: string } } };

/** What the API needs from `loadPaymentData`'s result. */
export function resultFromPaymentData(data: PaymentData): GooglePayResult | null {
  const token = data.paymentMethodData?.tokenizationData?.token;
  if (!token) return null;
  const info = data.paymentMethodData?.info ?? {};
  return {
    token,
    cardNetwork: info.cardNetwork && /^[A-Z_]{2,20}$/.test(info.cardNetwork) ? info.cardNetwork : undefined,
    cardDetails: info.cardDetails && /^\d{4}$/.test(info.cardDetails) ? info.cardDetails : undefined,
  };
}

/** Our own fallback (only when the official button can't render, e.g. a headless browser): TEST card. */
export const FALLBACK_TEST_RESULT: GooglePayResult = { token: GOOGLE_PAY_TEST.exampleToken, cardNetwork: 'VISA', cardDetails: '1111' };

export type PaymentsClient = {
  isReadyToPay: (request: unknown) => Promise<{ result: boolean }>;
  createButton: (options: Record<string, unknown>) => HTMLElement;
  loadPaymentData: (request: unknown) => Promise<PaymentData>;
};
type GoogleGlobal = { payments?: { api?: { PaymentsClient: new (options: { environment: 'TEST' }) => PaymentsClient } } };

let loading: Promise<PaymentsClient> | null = null;

/** Loads pay.js once and returns a TEST PaymentsClient (rejects when the script can't load). */
export function loadGooglePay(timeoutMs = 8000): Promise<PaymentsClient> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  const existing = (window as unknown as { google?: GoogleGlobal }).google?.payments?.api;
  if (existing) return Promise.resolve(new existing.PaymentsClient({ environment: GOOGLE_PAY_TEST.environment }));
  loading ??= new Promise<PaymentsClient>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GOOGLE_PAY_SCRIPT;
    script.async = true;
    const timer = window.setTimeout(() => reject(new Error('Google Pay timed out')), timeoutMs);
    script.onload = () => {
      window.clearTimeout(timer);
      const api = (window as unknown as { google?: GoogleGlobal }).google?.payments?.api;
      if (api) resolve(new api.PaymentsClient({ environment: GOOGLE_PAY_TEST.environment }));
      else reject(new Error('Google Pay API missing'));
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('Google Pay failed to load'));
    };
    document.head.appendChild(script);
  }).catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}
