'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/cn';
import { FALLBACK_TEST_RESULT, isReadyToPayRequest, loadGooglePay, paymentDataRequest, resultFromPaymentData, type GooglePayResult, type PaymentsClient } from './google-pay';

type Status = 'loading' | 'official' | 'fallback';

/**
 * The official Google Pay button (TEST environment), shown only when `isReadyToPay` says yes. If pay.js
 * can't load or the browser can't pay (a headless browser, no Google account), our own "G Pay (тест)"
 * button follows Google's brand rules (black, rounded, the G Pay mark) and submits the TEST token.
 */
export function GooglePayButton({ total, label, disabled, busy, onToken, onError }: {
  total: number;
  label: string;
  disabled?: boolean;
  busy?: boolean;
  onToken: (result: GooglePayResult) => void;
  onError?: (error: unknown) => void;
}) {
  const t = useTranslations('pay.method');
  const locale = useLocale();
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const clientRef = useRef<PaymentsClient | null>(null);
  // The button is created once; keep the latest props for its click handler.
  const latest = useRef({ total, label, onToken, onError, disabled, busy });
  latest.current = { total, label, onToken, onError, disabled, busy };

  useEffect(() => {
    let cancelled = false;
    loadGooglePay()
      .then(async (client) => {
        const ready = await client.isReadyToPay(isReadyToPayRequest());
        if (cancelled) return;
        if (!ready.result) {
          setStatus('fallback');
          return;
        }
        clientRef.current = client;
        const button = client.createButton({
          buttonColor: 'black',
          buttonType: 'pay',
          buttonSizeMode: 'fill',
          buttonRadius: 12,
          buttonLocale: locale === 'en' ? 'en' : 'ru',
          onClick: () => {
            const p = latest.current;
            if (p.disabled || p.busy) return;
            client
              .loadPaymentData(paymentDataRequest(p.total, p.label))
              .then((data) => {
                const result = resultFromPaymentData(data);
                if (result) p.onToken(result);
              })
              // CANCELED is the user closing the sheet: not an error.
              .catch((err: { statusCode?: string }) => {
                if (err?.statusCode !== 'CANCELED') p.onError?.(err);
              });
          },
        });
        host.current?.replaceChildren(button);
        setStatus('official');
      })
      .catch(() => {
        if (!cancelled) setStatus('fallback');
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  return (
    <div className="flex flex-col gap-2" data-testid="gpay" data-status={status}>
      <div ref={host} className={cn('h-12 w-full', status !== 'official' && 'hidden', (disabled || busy) && 'pointer-events-none opacity-60')} />
      {status === 'loading' ? (
        <div className="flex h-12 items-center justify-center rounded-xl bg-muted">
          <Spinner size="sm" label={t('gpayLoading')} />
        </div>
      ) : null}
      {status === 'fallback' ? (
        <button
          type="button"
          onClick={() => onToken(FALLBACK_TEST_RESULT)}
          disabled={disabled || busy}
          aria-label={t('gpayFallbackLabel')}
          data-testid="gpay-fallback"
          // Google's brand rules (a deliberate exception to the token-only rule): a black button with the
          // white "G Pay" mark in both themes.
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-black px-4 text-white shadow-sm transition-opacity duration-fast focus-ring hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Spinner size="sm" className="text-white" label={t('paying')} /> : null}
          <span className="text-[0.9375rem] font-medium">{t('gpayPayWith')}</span>
          <GPayMark />
          <span className="rounded-full border border-white/60 px-1.5 py-px text-[0.6875rem] font-semibold uppercase tracking-wide">{t('test')}</span>
        </button>
      ) : null}
    </div>
  );
}

/** The "G Pay" acceptance mark: the four-colour G and "Pay" in white (on black). */
function GPayMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 41 17" className="h-[18px] w-auto">
      <path fill="#4285F4" d="M15.6 8.7c0-.6-.1-1.1-.2-1.6H8v3h4.3a3.7 3.7 0 0 1-1.6 2.4v2h2.6c1.5-1.4 2.3-3.4 2.3-5.8z" />
      <path fill="#34A853" d="M8 16.4c2.2 0 4-.7 5.3-1.9l-2.6-2c-.7.5-1.6.8-2.7.8-2.1 0-3.9-1.4-4.5-3.3H.8v2.1A8 8 0 0 0 8 16.4z" />
      <path fill="#FBBC04" d="M3.5 10c-.2-.5-.3-1-.3-1.6s.1-1.1.3-1.6V4.7H.8a8 8 0 0 0 0 7.3L3.5 10z" />
      <path fill="#EA4335" d="M8 3.6c1.2 0 2.3.4 3.1 1.2l2.3-2.3A8 8 0 0 0 .8 4.7l2.7 2.1C4.1 4.9 5.9 3.6 8 3.6z" />
      <path fill="#fff" d="M19.5 2.6h3.7c1 0 1.8.3 2.5.9.7.6 1 1.4 1 2.3s-.3 1.7-1 2.3c-.7.6-1.5.9-2.5.9h-2.2v3.8h-1.5V2.6zm1.5 1.4v3.7h2.2c.6 0 1-.2 1.4-.6.4-.4.6-.8.6-1.3s-.2-.9-.6-1.3c-.3-.4-.8-.6-1.4-.6H21zm9.2 1.6c1.1 0 1.9.3 2.6.9.6.6.9 1.4.9 2.4v4.9h-1.4v-1.1h-.1c-.6.9-1.4 1.3-2.4 1.3-.9 0-1.6-.3-2.2-.8-.6-.5-.9-1.1-.9-1.9 0-.8.3-1.5.9-1.9.6-.5 1.4-.7 2.4-.7.9 0 1.6.2 2.2.5v-.3c0-.5-.2-1-.6-1.3-.4-.4-.9-.6-1.4-.6-.8 0-1.5.4-1.9 1l-1.3-.8c.7-1 1.8-1.6 3.2-1.6zm-1.9 5.8c0 .4.2.7.5 1 .3.2.7.4 1.1.4.6 0 1.1-.2 1.6-.7.5-.4.7-1 .7-1.6-.4-.4-1.1-.6-1.9-.6-.6 0-1.1.1-1.5.4-.3.3-.5.7-.5 1.1zM41 5.8l-4.8 11h-1.5l1.8-3.9-3.1-7.1H35l2.3 5.5 2.2-5.5H41z" />
    </svg>
  );
}
