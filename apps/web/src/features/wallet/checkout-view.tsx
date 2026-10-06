'use client';

import { DEMO_TEST_CARD, type TopupDto } from '@autoc/shared';
import { CircleAlert, CircleCheck, Clock, CreditCard, FlaskConical, ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { hasErrorCode } from '@/lib/api/errors';
import { notify } from '@/lib/toast';
import { useCreateTopup, useDemoConfirm, useTopup } from './api';
import { useWalletErrorMessage } from './errors';
import { cardDigits, checkCard, formatCardNumber, formatExpiry, type CardErrors } from './format';

/** /wallet/checkout/[topupId] — the demo provider's in-app checkout (API.md §9.1). No real money moves. */
export function CheckoutView({ topupId }: { topupId: string }) {
  const t = useTranslations('wallet.checkout');
  const query = useTopup(topupId);

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-5">
      <PageHeader back="/wallet" title={t('title')} description={t('description')} />
      {query.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      ) : query.isError ? (
        hasErrorCode(query.error, 'NOT_FOUND') || hasErrorCode(query.error, 'VALIDATION_ERROR') ? (
          <EmptyState
            icon={ReceiptText}
            title={t('notFound')}
            description={t('notFoundHint')}
            action={
              <Button asChild>
                <Link href="/wallet">{t('backToWallet')}</Link>
              </Button>
            }
            className="rounded-2xl border bg-card"
          />
        ) : (
          <ErrorState onRetry={() => void query.refetch()} retrying={query.isFetching} className="rounded-2xl border bg-card" />
        )
      ) : (
        <Checkout topup={query.data} />
      )}
    </div>
  );
}

function Checkout({ topup }: { topup: TopupDto }) {
  const t = useTranslations('wallet.checkout');
  const tw = useTranslations('wallet');
  const expired = topup.status === 'expired' || (topup.status === 'pending' && Date.parse(topup.expiresAt) <= Date.now());

  return (
    <>
      <Card className="flex items-center gap-4" data-testid="checkout-summary">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
          <CreditCard className="size-6" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-sm text-muted-foreground">{t('toPay')}</span>
          <span className="text-2xl font-semibold tabular-nums tracking-tight" data-testid="checkout-amount">
            {t('tenge', { amount: topup.amount })}
          </span>
          <span className="text-sm text-muted-foreground">{t('youGet', { coins: tw('coins', { amount: topup.amount }) })}</span>
        </div>
      </Card>
      <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
        <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t('demoNotice')}
      </p>
      {topup.status === 'succeeded' ? (
        <Outcome tone="success" title={t('succeeded')} text={t('succeededHint', { coins: tw('coins', { amount: topup.amount }) })} />
      ) : topup.status === 'declined' ? (
        <Retry amount={topup.amount} kind="declined" />
      ) : expired ? (
        <Retry amount={topup.amount} kind="expired" />
      ) : (
        <CardForm topup={topup} />
      )}
    </>
  );
}

function Outcome({ tone, title, text }: { tone: 'success' | 'danger'; title: string; text: string }) {
  const t = useTranslations('wallet.checkout');
  return (
    <div
      role="status"
      data-testid="checkout-outcome"
      data-tone={tone}
      className={tone === 'success' ? 'flex flex-col gap-3 rounded-2xl bg-success-soft p-4 text-success-soft-foreground' : 'flex flex-col gap-3 rounded-2xl bg-danger-soft p-4 text-danger-soft-foreground'}
    >
      <p className="flex items-center gap-2 text-base font-semibold">
        {tone === 'success' ? <CircleCheck aria-hidden="true" className="size-5" /> : <CircleAlert aria-hidden="true" className="size-5" />}
        {title}
      </p>
      <p className="text-sm">{text}</p>
      <Button asChild className="self-start">
        <Link href="/wallet">{t('backToWallet')}</Link>
      </Button>
    </div>
  );
}

/** A declined or expired top-up can't be confirmed again: offer a fresh one for the same amount. */
function Retry({ amount, kind }: { amount: number; kind: 'declined' | 'expired' }) {
  const t = useTranslations('wallet.checkout');
  const router = useRouter();
  const errorMessage = useWalletErrorMessage();
  const create = useCreateTopup();
  return (
    <div role="alert" data-testid="checkout-outcome" data-tone="danger" data-kind={kind} className="flex flex-col gap-3 rounded-2xl bg-danger-soft p-4 text-danger-soft-foreground">
      <p className="flex items-center gap-2 text-base font-semibold">
        {kind === 'expired' ? <Clock aria-hidden="true" className="size-5" /> : <CircleAlert aria-hidden="true" className="size-5" />}
        {t(kind)}
      </p>
      <p className="text-sm">{t(`${kind}Hint`)}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          loading={create.isPending}
          onClick={() =>
            create.mutate(amount, {
              onSuccess: ({ topup }) => router.replace(`/wallet/checkout/${topup.id}`),
              onError: (error) => notify.error(errorMessage(error)),
            })
          }
        >
          {t('tryAgain')}
        </Button>
        <Button asChild variant="secondary">
          <Link href="/wallet">{t('backToWallet')}</Link>
        </Button>
      </div>
    </div>
  );
}

function CardForm({ topup }: { topup: TopupDto }) {
  const t = useTranslations('wallet.checkout');
  const tw = useTranslations('wallet');
  const router = useRouter();
  const online = useOnlineStatus();
  const errorMessage = useWalletErrorMessage();
  const confirm = useDemoConfirm(topup.id);
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [errors, setErrors] = useState<CardErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<unknown>(null);

  const pay = async () => {
    setSubmitted(true);
    const next = checkCard({ number, expiry, cvc });
    setErrors(next);
    if (Object.keys(next).length) return;
    setServerError(null);
    try {
      const result = await confirm.mutateAsync({ cardNumber: cardDigits(number), expiry: expiry || undefined, cvc: cvc || undefined });
      if (result.status === 'succeeded') {
        notify.success(t('toast', { coins: tw('coins', { amount: result.amount }) }));
        router.replace('/wallet');
      }
    } catch (err) {
      setServerError(err);
    }
  };

  const live = (patch: Partial<{ number: string; expiry: string; cvc: string }>) => {
    if (submitted) setErrors(checkCard({ number, expiry, cvc, ...patch }));
  };

  return (
    <Card>
      <form
        noValidate
        className="flex flex-col gap-4"
        aria-label={t('formLabel')}
        onSubmit={(e) => {
          e.preventDefault();
          void pay();
        }}
      >
        <FormField label={t('cardNumber')} required error={errors.number ? t(`cardErrors.number.${errors.number}`) : undefined}>
          <Input
            value={number}
            onChange={(e) => {
              const v = formatCardNumber(e.target.value);
              setNumber(v);
              live({ number: v });
            }}
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="0000 0000 0000 0000"
            maxLength={23}
            data-testid="card-number"
          />
        </FormField>
        <p className="-mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground" data-testid="test-card-hint">
          <span>{t('testCard', { card: formatCardNumber(DEMO_TEST_CARD) })}</span>
          <button
            type="button"
            className="min-h-9 rounded-md font-medium text-primary underline-offset-4 hover:underline focus-ring"
            onClick={() => {
              const v = formatCardNumber(DEMO_TEST_CARD);
              setNumber(v);
              live({ number: v });
            }}
          >
            {t('useTestCard')}
          </button>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('expiry')} error={errors.expiry ? t(`cardErrors.expiry.${errors.expiry}`) : undefined}>
            <Input
              value={expiry}
              onChange={(e) => {
                const v = formatExpiry(e.target.value);
                setExpiry(v);
                live({ expiry: v });
              }}
              inputMode="numeric"
              autoComplete="cc-exp"
              placeholder={t('expiryPlaceholder')}
              maxLength={5}
            />
          </FormField>
          <FormField label={t('cvc')} error={errors.cvc ? t('cardErrors.cvc') : undefined}>
            <Input
              value={cvc}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                setCvc(v);
                live({ cvc: v });
              }}
              inputMode="numeric"
              autoComplete="cc-csc"
              placeholder="123"
              maxLength={4}
            />
          </FormField>
        </div>
        {serverError ? (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground" data-testid="checkout-error">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {errorMessage(serverError)}
          </p>
        ) : null}
        <Button type="submit" size="lg" fullWidth loading={confirm.isPending} disabled={!online}>
          {t('pay', { amount: topup.amount })}
        </Button>
      </form>
    </Card>
  );
}
