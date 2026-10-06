'use client';

import type { WalletDto, WalletTransactionDto, WalletTxKind } from '@autoc/shared';
import { ArrowDownLeft, ArrowUpRight, Coins, Crown, History, Nfc, Plus, ReceiptText, Send, ShieldCheck, Snowflake, Store, Undo2, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { InfiniteList } from '@/components/ui/infinite-list';
import { ListGroup, ListItem } from '@/components/ui/list-item';
import { PageHeader } from '@/components/ui/page-header';
import { ListItemSkeleton, Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/ui/user-avatar';
import { cn } from '@/lib/cn';
import { useWallet, useWalletTransactions } from './api';
import { filterKind, formatSignedCoins, TX_FILTERS, type TxFilter } from './format';
import { TopupDialog } from './topup-dialog';
import { TransferDialog } from './transfer-dialog';

/** /wallet — balance, top-up, transfer and the ledger (API.md §9.1). */
export function WalletView() {
  const t = useTranslations('wallet');
  const wallet = useWallet();
  const [topupOpen, setTopupOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader back="/profile" title={t('title')} description={t('description')} />
      {wallet.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-44 w-full rounded-2xl" />
        </div>
      ) : wallet.isError ? (
        <ErrorState onRetry={() => void wallet.refetch()} retrying={wallet.isFetching} className="rounded-2xl border bg-card" />
      ) : (
        <BalanceCard wallet={wallet.data} onTopup={() => setTopupOpen(true)} onTransfer={() => setTransferOpen(true)} />
      )}
      {wallet.data ? <PremiumRow wallet={wallet.data} /> : null}
      <TransactionHistory />
      <TopupDialog open={topupOpen} onOpenChange={setTopupOpen} />
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} />
    </div>
  );
}

function BalanceCard({ wallet, onTopup, onTransfer }: { wallet: WalletDto; onTopup: () => void; onTransfer: () => void }) {
  const t = useTranslations('wallet');
  return (
    <Card className="flex flex-col gap-4" data-testid="wallet-balance-card">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
          <Wallet className="size-6" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-sm text-muted-foreground">{t('balance')}</span>
          <span className="text-3xl font-bold tabular-nums tracking-tight" data-testid="wallet-balance" data-balance={wallet.balance}>
            {t('coins', { amount: wallet.balance })}
          </span>
          <span className="text-sm text-muted-foreground">{t('rate')}</span>
        </div>
      </div>
      {wallet.frozen ? (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground" data-testid="wallet-frozen">
          <Snowflake aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('frozen')}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button leadingIcon={<Plus aria-hidden="true" />} onClick={onTopup} disabled={wallet.frozen} fullWidth>
          {t('topupAction')}
        </Button>
        <Button variant="secondary" leadingIcon={<Send aria-hidden="true" />} onClick={onTransfer} disabled={wallet.frozen || wallet.balance <= 0} fullWidth>
          {t('transferAction')}
        </Button>
        <Button asChild variant="secondary" leadingIcon={<Nfc aria-hidden="true" />} fullWidth className="sm:col-span-2" data-testid="wallet-pay-at-point">
          <Link href="/pay">{t('payAtPoint')}</Link>
        </Button>
      </div>
      <p className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="wallet-no-cashout">
        <Coins aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t('noCashOut')}
      </p>
    </Card>
  );
}

function PremiumRow({ wallet }: { wallet: WalletDto }) {
  const t = useTranslations('wallet');
  const format = useFormatter();
  const p = wallet.premium;
  const until = p.currentPeriodEnd ? format.dateTime(new Date(p.currentPeriodEnd), { dateStyle: 'medium' }) : '';
  return (
    <ListGroup>
      <ListItem
        href="/premium"
        leading={
          <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-premium-soft text-premium-soft-foreground">
            <Crown className="size-5" />
          </span>
        }
        title={t('premiumRow')}
        description={p.isPremium ? (p.status === 'cancelled' ? t('premiumEnds', { date: until }) : t('premiumRenews', { date: until })) : t('premiumOffer', { price: p.priceCoins })}
      />
    </ListGroup>
  );
}

const TX_ICON: Record<WalletTxKind, typeof Plus> = {
  topup: ArrowDownLeft,
  transfer_in: ArrowDownLeft,
  transfer_out: ArrowUpRight,
  subscription: Crown,
  admin_adjust: ShieldCheck,
  refund: Undo2,
  purchase: ReceiptText,
  sale: Store,
};

function TransactionHistory() {
  const t = useTranslations('wallet.history');
  const [filter, setFilter] = useState<TxFilter>('all');
  const query = useWalletTransactions(filterKind(filter));

  return (
    <section aria-labelledby="wallet-history-heading" className="flex flex-col gap-3">
      <h2 id="wallet-history-heading" className="text-xl font-semibold tracking-tight">
        {t('title')}
      </h2>
      <div role="group" aria-label={t('filterLabel')} className="flex flex-wrap gap-2">
        {TX_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              'min-h-9 rounded-full px-3.5 text-sm font-medium transition-colors duration-fast focus-ring',
              filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {t(`filters.${f}`)}
          </button>
        ))}
      </div>
      <InfiniteList
        query={query}
        label={t('title')}
        getKey={(tx) => tx.id}
        renderItem={(tx) => <TransactionRow tx={tx} />}
        skeleton={<ListItemSkeleton />}
        skeletonCount={3}
        listClassName="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t"
        empty={<EmptyState icon={History} title={t('emptyTitle')} description={filter === 'all' ? t('emptyHint') : t('emptyFiltered')} className="rounded-2xl border bg-card py-8" />}
      />
    </section>
  );
}

export function TransactionRow({ tx }: { tx: WalletTransactionDto }) {
  const t = useTranslations('wallet.history');
  const tw = useTranslations('wallet');
  const format = useFormatter();
  const locale = useLocale();
  const Icon = TX_ICON[tx.kind] ?? Coins;
  const who = tx.counterparty ? tx.counterparty.name || `@${tx.counterparty.nickname}` : t('someone');
  const title = tx.kind === 'transfer_in' ? t('kinds.transfer_in', { name: who }) : tx.kind === 'transfer_out' ? t('kinds.transfer_out', { name: who }) : t(`kinds.${tx.kind}`);
  const positive = tx.amount > 0;

  return (
    <div className="flex items-center gap-3 px-4 py-3" data-testid="wallet-tx" data-kind={tx.kind}>
      {tx.counterparty ? (
        <Link href={`/u/${tx.counterparty.id}`} className="shrink-0 rounded-full focus-ring" aria-label={who}>
          <UserAvatar user={tx.counterparty} size="md" decorative />
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full',
            tx.kind === 'subscription' ? 'bg-premium-soft text-premium-soft-foreground' : positive ? 'bg-success-soft text-success-soft-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          <Icon className="size-5" />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="break-words text-[0.9375rem] font-medium">{title}</span>
        {tx.note ? <span className="break-words text-sm text-foreground">«{tx.note}»</span> : null}
        <span className="text-sm text-muted-foreground">
          <time dateTime={tx.createdAt}>{format.dateTime(new Date(tx.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</time>
          {' · '}
          {t('balanceAfter', { balance: tw('coins', { amount: tx.balanceAfter }) })}
        </span>
      </span>
      <span className={cn('shrink-0 font-semibold tabular-nums', positive ? 'text-success' : 'text-foreground')} data-testid="wallet-tx-amount">
        <span className="sr-only">{positive ? t('credit') : t('debit')}: </span>
        {formatSignedCoins(tx.amount, locale)}
      </span>
    </div>
  );
}
