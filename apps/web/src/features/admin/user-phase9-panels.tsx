'use client';

import { WALLET_LIMITS, WALLET_TX_KINDS, type AdminVoteDto, type AdminWalletDto, type AdminWalletTransactionDto, type WalletTxKind } from '@autoc/shared';
import { History, Snowflake, Sun, ThumbsDown, ThumbsUp, Trash2, Vote, WalletCards } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { formatCoins, formatSignedCoins } from '@/features/wallet/format';
import { adminApi, useAdminMutation, useAdminVotes, useAdminWallet, useAdminWalletTransactions } from './api';
import { NoteDialog } from './note-dialog';
import { Facts, FilterSelect, PagedList, Section, TimeCell, ToneBadge, UserCell } from './ui';
import { checkAdjust } from './view-models';

/** Admin user detail: balance, premium, freeze state, ledger, adjust ± / freeze / unfreeze (API.md §9.1). */
export function AdminWalletPanel({ userId, name, protectedTarget }: { userId: string; name: string; protectedTarget: boolean }) {
  const t = useTranslations('admin.wallet');
  const query = useAdminWallet(userId);
  const [dialog, setDialog] = useState<'adjust' | 'freeze' | 'unfreeze' | null>(null);

  return (
    <Section title={t('title')}>
      {query.isPending ? (
        <Skeleton className="h-32 w-full rounded-2xl" />
      ) : query.isError ? (
        <ErrorState compact onRetry={() => void query.refetch()} retrying={query.isFetching} className="rounded-2xl border bg-card" />
      ) : (
        <>
          <WalletFacts wallet={query.data} />
          {protectedTarget ? null : (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" leadingIcon={<WalletCards aria-hidden="true" />} onClick={() => setDialog('adjust')} data-testid="admin-wallet-adjust">
                {t('adjust')}
              </Button>
              {query.data.frozen ? (
                <Button variant="outline" leadingIcon={<Sun aria-hidden="true" />} onClick={() => setDialog('unfreeze')}>
                  {t('unfreeze')}
                </Button>
              ) : (
                <Button variant="danger" leadingIcon={<Snowflake aria-hidden="true" />} onClick={() => setDialog('freeze')}>
                  {t('freeze')}
                </Button>
              )}
            </div>
          )}
          <WalletLedger userId={userId} />
          <AdjustDialog open={dialog === 'adjust'} onClose={() => setDialog(null)} userId={userId} name={name} balance={query.data.balance} />
          <FreezeDialog open={dialog === 'freeze' || dialog === 'unfreeze'} unfreeze={dialog === 'unfreeze'} onClose={() => setDialog(null)} userId={userId} name={name} />
        </>
      )}
    </Section>
  );
}

function WalletFacts({ wallet }: { wallet: AdminWalletDto }) {
  const t = useTranslations('admin.wallet');
  const tw = useTranslations('wallet');
  return (
    <Facts
      items={[
        {
          label: t('balance'),
          value: (
            <span className="font-semibold tabular-nums" data-testid="admin-wallet-balance" data-balance={wallet.balance}>
              {tw('coins', { amount: wallet.balance })}
            </span>
          ),
        },
        {
          label: t('state'),
          value: wallet.frozen ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <ToneBadge tone="warning">{t('frozen')}</ToneBadge>
              <TimeCell iso={wallet.frozenAt} relative={false} />
            </span>
          ) : (
            <ToneBadge tone="success">{t('active')}</ToneBadge>
          ),
        },
        {
          label: t('premium'),
          value: wallet.premium.isPremium ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <ToneBadge tone="primary">{wallet.premium.status === 'cancelled' ? t('premiumCancelled') : t('premiumActive')}</ToneBadge>
              <TimeCell iso={wallet.premium.currentPeriodEnd} relative={false} />
            </span>
          ) : (
            t('premiumNone')
          ),
        },
        { label: t('sentLast24h'), value: tw('coins', { amount: wallet.sentLast24h }) },
      ]}
    />
  );
}

function WalletLedger({ userId }: { userId: string }) {
  const t = useTranslations('admin.wallet');
  const tk = useTranslations('wallet.history.kindNames');
  const [kind, setKind] = useState<WalletTxKind | undefined>();
  const query = useAdminWalletTransactions(userId, { kind });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:max-w-xs">
        <FilterSelect label={t('kind')} value={kind} onChange={setKind} options={WALLET_TX_KINDS.map((k) => ({ value: k, label: tk(k) }))} />
      </div>
      <PagedList query={query} columns={3} empty={{ icon: History, title: t('noTransactions') }}>
        {(items) => (
          <ul className="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t" aria-label={t('ledger')}>
            {items.map((tx) => (
              <li key={tx.id}>
                <LedgerRow tx={tx} />
              </li>
            ))}
          </ul>
        )}
      </PagedList>
    </div>
  );
}

function LedgerRow({ tx }: { tx: AdminWalletTransactionDto }) {
  const t = useTranslations('admin.wallet');
  const tk = useTranslations('wallet.history.kindNames');
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3 text-sm" data-testid="admin-wallet-tx" data-kind={tx.kind}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{tk(tx.kind)}</span>
        <span className={cn('font-semibold tabular-nums', tx.amount > 0 ? 'text-success' : 'text-foreground')}>{formatSignedCoins(tx.amount, locale)}</span>
      </div>
      {tx.counterparty ? <UserCell user={tx.counterparty} /> : null}
      {tx.note ? <p className="break-words">«{tx.note}»</p> : null}
      <p className="flex flex-wrap gap-x-3 text-muted-foreground">
        <TimeCell iso={tx.createdAt} relative={false} />
        <span>{t('balanceAfter', { balance: formatCoins(tx.balanceAfter, locale) })}</span>
        {tx.idempotencyKey ? <span className="break-all font-mono text-xs">{tx.idempotencyKey}</span> : null}
      </p>
    </div>
  );
}

function AdjustDialog({ open, onClose, userId, name, balance }: { open: boolean; onClose: () => void; userId: string; name: string; balance: number }) {
  const t = useTranslations('admin.wallet');
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const mutation = useAdminMutation(({ amount, note }: { amount: number; note: string }) => adminApi.adjustWallet(userId, amount, note));
  const check = checkAdjust(text, balance, WALLET_LIMITS.adminAdjustMaxAbs);
  return (
    <NoteDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
          setText('');
          setTouched(false);
        }
      }}
      title={t('adjustTitle', { name })}
      description={t('adjustDescription')}
      confirmLabel={t('adjust')}
      successMessage={t('adjusted')}
      blocked={!check.ok}
      onConfirm={async (note) => {
        if (!check.ok) return;
        await mutation.mutateAsync({ amount: check.amount, note });
        setText('');
        setTouched(false);
      }}
    >
      <FormField
        label={t('amount')}
        required
        hint={t('amountHint', { max: formatCoins(WALLET_LIMITS.adminAdjustMaxAbs) })}
        error={touched && !check.ok ? t(`amountErrors.${check.error}`, { balance }) : undefined}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => setTouched(true)} inputMode="text" placeholder="+500 / -200" autoComplete="off" data-testid="admin-adjust-amount" />
      </FormField>
    </NoteDialog>
  );
}

function FreezeDialog({ open, unfreeze, onClose, userId, name }: { open: boolean; unfreeze: boolean; onClose: () => void; userId: string; name: string }) {
  const t = useTranslations('admin.wallet');
  const mutation = useAdminMutation(({ note }: { note: string }) => (unfreeze ? adminApi.unfreezeWallet(userId, note) : adminApi.freezeWallet(userId, note)));
  return (
    <NoteDialog
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      tone={unfreeze ? 'default' : 'danger'}
      title={unfreeze ? t('unfreezeTitle', { name }) : t('freezeTitle', { name })}
      description={unfreeze ? t('unfreezeDescription') : t('freezeDescription')}
      confirmLabel={unfreeze ? t('unfreeze') : t('freeze')}
      successMessage={unfreeze ? t('unfrozen') : t('frozenDone')}
      onConfirm={(note) => mutation.mutateAsync({ note })}
    />
  );
}

/** Admin user detail: votes received with the voters (admins only), remove a vote (API.md §9.3). */
export function AdminVotesPanel({ userId, protectedTarget }: { userId: string; protectedTarget: boolean }) {
  const t = useTranslations('admin.votes');
  const [filter, setFilter] = useState<'all' | 'up' | 'down'>('all');
  const query = useAdminVotes(userId, { value: filter === 'up' ? 1 : filter === 'down' ? -1 : undefined });
  const [removing, setRemoving] = useState<AdminVoteDto | null>(null);
  const mutation = useAdminMutation(({ id, note }: { id: string; note: string }) => adminApi.removeVote(id, note));

  return (
    <Section title={t('title')}>
      <SegmentedControl
        label={t('filter')}
        value={filter}
        onValueChange={setFilter}
        options={[
          { value: 'all', label: t('all') },
          { value: 'up', label: t('up') },
          { value: 'down', label: t('down') },
        ]}
        className="sm:max-w-sm"
      />
      <PagedList query={query} columns={3} empty={{ icon: Vote, title: t('empty') }}>
        {(items) => (
          <ul className="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t" aria-label={t('title')}>
            {items.map((vote) => (
              <li key={vote.id}>
                <VoteRow vote={vote} onRemove={protectedTarget ? undefined : () => setRemoving(vote)} />
              </li>
            ))}
          </ul>
        )}
      </PagedList>
      <NoteDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
        tone="danger"
        title={t('removeTitle')}
        description={t('removeDescription')}
        confirmLabel={t('remove')}
        successMessage={t('removed')}
        onConfirm={(note) => mutation.mutateAsync({ id: removing!.id, note })}
      />
    </Section>
  );
}

function VoteRow({ vote, onRemove }: { vote: AdminVoteDto; onRemove?: () => void }) {
  const t = useTranslations('admin.votes');
  const tv = useTranslations('votes');
  return (
    <div className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm" data-testid="admin-vote" data-value={vote.value}>
      <span
        aria-hidden="true"
        className={cn('mt-1 flex size-8 shrink-0 items-center justify-center rounded-full', vote.value === 1 ? 'bg-success-soft text-success-soft-foreground' : 'bg-danger-soft text-danger-soft-foreground')}
      >
        {vote.value === 1 ? <ThumbsUp className="size-4" /> : <ThumbsDown className="size-4" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium">
          <span className="sr-only">{vote.value === 1 ? t('up') : t('down')}: </span>
          {tv(`reasons.${vote.reason}`)}
          <span className="font-normal text-muted-foreground"> · {t('weight', { weight: vote.weight })}</span>
        </span>
        <UserCell user={vote.voter} />
        {vote.comment ? <p className="break-words">«{vote.comment}»</p> : null}
        <TimeCell iso={vote.createdAt} />
      </div>
      {onRemove ? (
        <Button size="sm" variant="ghost" leadingIcon={<Trash2 aria-hidden="true" />} onClick={onRemove}>
          {t('remove')}
        </Button>
      ) : null}
    </div>
  );
}
