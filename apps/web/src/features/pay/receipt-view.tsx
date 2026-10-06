'use client';

import type { PayReceiptDto } from '@autoc/shared';
import { ChevronRight, FlaskConical, ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { InfiniteList } from '@/components/ui/infinite-list';
import { PageHeader } from '@/components/ui/page-header';
import { ListItemSkeleton, Skeleton } from '@/components/ui/skeleton';
import { CategoryTile } from '@/components/services/category';
import { hasErrorCode } from '@/lib/api/errors';
import { formatCoins } from '@/features/wallet/format';
import { usePayOrder, usePayOrders } from './api';
import { qtyLabel } from './format';

/** /pay/orders/[id] — the receipt. Right after paying (`?new=1`) the check mark animates in. */
export function PayReceiptView({ orderId }: { orderId: string }) {
  const t = useTranslations('pay.receipt');
  const query = usePayOrder(orderId);
  const fresh = useSearchParams().get('new') === '1';

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-4">
      <PageHeader back={fresh ? '/wallet' : '/pay/orders'} title={t('title')} className="pb-0" />
      {query.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      ) : query.isError ? (
        hasErrorCode(query.error, 'NOT_FOUND') || hasErrorCode(query.error, 'VALIDATION_ERROR') ? (
          <EmptyState icon={ReceiptText} title={t('notFound')} description={t('notFoundHint')} className="rounded-2xl border bg-card" />
        ) : (
          <ErrorState onRetry={() => void query.refetch()} retrying={query.isFetching} className="rounded-2xl border bg-card" />
        )
      ) : (
        <Receipt receipt={query.data} fresh={fresh} />
      )}
    </div>
  );
}

function AnimatedCheck({ animate }: { animate: boolean }) {
  return (
    <span aria-hidden="true" className={animate ? 'flex size-20 animate-check-pop items-center justify-center rounded-full bg-success text-success-foreground shadow-md' : 'flex size-20 items-center justify-center rounded-full bg-success text-success-foreground shadow-md'}>
      <svg viewBox="0 0 24 24" className="size-11" fill="none" stroke="currentColor" strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5 10 17.5 19 7" strokeDasharray="48" className={animate ? 'animate-check-draw' : undefined} />
      </svg>
    </span>
  );
}

function Receipt({ receipt, fresh }: { receipt: PayReceiptDto; fresh: boolean }) {
  const t = useTranslations('pay');
  const format = useFormatter();
  const locale = useLocale();
  const card = receipt.card;

  return (
    <>
      <Card className="flex flex-col items-center gap-3 py-6 text-center" data-testid="receipt">
        <AnimatedCheck animate={fresh} />
        <div role="status" className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">{t('receipt.paid')}</h2>
          <p className="text-3xl font-bold tabular-nums tracking-tight" data-testid="receipt-total" data-total={receipt.total}>
            {t('coins', { amount: receipt.total })}
          </p>
          <p className="text-[0.9375rem] text-muted-foreground">
            {receipt.point.name} · <time dateTime={receipt.paidAt}>{format.dateTime(new Date(receipt.paidAt), { dateStyle: 'medium', timeStyle: 'short' })}</time>
          </p>
        </div>
      </Card>

      <Card className="flex flex-col gap-0 p-0">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <CategoryTile category={receipt.point.category} className="size-10" iconClassName="size-5" />
          <div className="flex min-w-0 flex-col">
            <span className="break-words font-medium">{receipt.point.name}</span>
            <span className="break-words text-sm text-muted-foreground">{receipt.point.address}</span>
          </div>
        </div>
        <ul className="flex flex-col px-4 py-2" aria-label={t('receipt.items')}>
          {receipt.items.map((line, i) => (
            <li key={line.itemId ?? i} className="flex items-start justify-between gap-3 py-2" data-testid="receipt-line">
              <span className="flex min-w-0 flex-col">
                <span className="break-words text-[0.9375rem]">{line.name ?? t('receipt.freeAmount')}</span>
                {line.unit ? (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {t('receipt.lineDetail', { qty: qtyLabel(line.qty, line.unit, locale, (u) => t(`unitShort.${u}`)), price: formatCoins(line.priceCoins, locale) })}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 font-medium tabular-nums">{formatCoins(line.totalCoins, locale)}</span>
            </li>
          ))}
        </ul>
        <dl className="flex flex-col gap-2 border-t px-4 py-3 text-[0.9375rem]">
          <Row label={t('total')} value={<strong className="tabular-nums">{t('coins', { amount: receipt.total })}</strong>} />
          <Row
            label={t('receipt.method')}
            value={
              receipt.method === 'google_pay'
                ? `${t('method.gpay')} (${t('method.test')})${card?.last4 ? ` · ${card.network ?? ''} •••• ${card.last4}` : ''}`
                : t('method.coins')
            }
          />
          {receipt.balanceAfter !== null ? (
            <Row label={t('receipt.balanceAfter')} value={<span data-testid="receipt-balance" data-balance={receipt.balanceAfter} className="tabular-nums">{t('coins', { amount: receipt.balanceAfter })}</span>} />
          ) : null}
          <Row label={t('receipt.number')} value={<span className="font-mono text-sm">{receipt.orderId.slice(-8).toUpperCase()}</span>} />
        </dl>
      </Card>

      <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
        <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t('receipt.demo')}
      </p>

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button asChild size="lg" fullWidth>
          <Link href="/wallet">{t('receipt.done')}</Link>
        </Button>
        <Button asChild size="lg" variant="secondary" fullWidth>
          <Link href="/pay/orders">{t('receipt.history')}</Link>
        </Button>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-end">{value}</dd>
    </div>
  );
}

/** /pay/orders — my payments at points. */
export function PayOrdersView() {
  const t = useTranslations('pay');
  const format = useFormatter();
  const query = usePayOrders();
  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-4">
      <PageHeader back="/pay" title={t('orders.title')} description={t('orders.description')} />
      <InfiniteList
        query={query}
        label={t('orders.title')}
        getKey={(o) => o.orderId}
        skeleton={<ListItemSkeleton />}
        skeletonCount={3}
        listClassName="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t"
        empty={
          <EmptyState
            icon={ReceiptText}
            title={t('orders.emptyTitle')}
            description={t('orders.emptyHint')}
            action={
              <Button asChild>
                <Link href="/pay">{t('orders.payNow')}</Link>
              </Button>
            }
            className="rounded-2xl border bg-card py-8"
          />
        }
        renderItem={(o) => (
          <Link href={`/pay/orders/${o.orderId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent focus-ring focus-visible:-outline-offset-2" data-testid="pay-order">
            <CategoryTile category={o.point.category} className="size-10" iconClassName="size-5" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="break-words font-medium">{o.point.name}</span>
              <span className="text-sm text-muted-foreground">
                {format.dateTime(new Date(o.paidAt), { dateStyle: 'medium', timeStyle: 'short' })} · {o.method === 'google_pay' ? t('method.gpay') : t('method.coins')}
              </span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums">−{t('coins', { amount: o.total })}</span>
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
          </Link>
        )}
      />
    </div>
  );
}
