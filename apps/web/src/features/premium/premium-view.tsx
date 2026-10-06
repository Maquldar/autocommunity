'use client';

import { PREMIUM, PREMIUM_PERK_LIMITS, WALLET_LIMITS, type PremiumDto, type PremiumPerkLimit, type WalletDto } from '@autoc/shared';
import { CalendarClock, CarFront, Check, CircleAlert, Crown, Images, RefreshCw, Siren, UsersRound, UserRoundPlus, Wallet } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { PremiumBadge } from '@/components/ui/user-avatar';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { notify } from '@/lib/toast';
import { usePremiumAction, useWallet } from '@/features/wallet/api';
import { useWalletErrorMessage } from '@/features/wallet/errors';
import { premiumView } from '@/features/wallet/format';
import { TopupDialog } from '@/features/wallet/topup-dialog';

const PERKS: { key: PremiumPerkLimit; icon: typeof CarFront }[] = [
  { key: 'vehicles', icon: CarFront },
  { key: 'postMedia', icon: Images },
  { key: 'communitiesOwned', icon: UsersRound },
  { key: 'communityMemberships', icon: UserRoundPlus },
];

/** /premium — perks (from the contract limits), price, subscribe / cancel / resume (API.md §9.2). */
export function PremiumView() {
  const t = useTranslations('premium');
  const wallet = useWallet();

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-6">
      <PageHeader back="/profile" title={t('title')} description={t('description')} />
      {wallet.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      ) : wallet.isError ? (
        <ErrorState onRetry={() => void wallet.refetch()} retrying={wallet.isFetching} className="rounded-2xl border bg-card" />
      ) : (
        <>
          <StatusCard wallet={wallet.data} />
          <Perks premium={wallet.data.premium} />
        </>
      )}
    </div>
  );
}

function StatusCard({ wallet }: { wallet: WalletDto }) {
  const t = useTranslations('premium');
  const tw = useTranslations('wallet');
  const format = useFormatter();
  const online = useOnlineStatus();
  const errorMessage = useWalletErrorMessage();
  const action = usePremiumAction();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmSubscribe, setConfirmSubscribe] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const view = premiumView(wallet.premium, wallet.balance);
  const date = view.periodEnd ? format.dateTime(new Date(view.periodEnd), { dateStyle: 'long' }) : '';

  const run = async (kind: 'subscribe' | 'cancel' | 'resume') => {
    try {
      await action.mutateAsync(kind);
      notify.success(t(`done.${kind}`));
    } catch (error) {
      notify.error(errorMessage(error));
      throw error;
    }
  };

  return (
    <Card className="flex flex-col gap-4" data-testid="premium-status" data-active={view.active}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-premium text-premium-foreground">
          <Crown className="size-6" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-lg font-semibold">{t('price', { price: view.price, days: wallet.premium.periodDays || PREMIUM.periodDays })}</p>
          {view.active ? <PremiumBadge className="self-start" /> : <span className="text-sm text-muted-foreground">{t('inactive')}</span>}
        </div>
      </div>

      {view.active ? (
        <dl className="grid grid-cols-1 gap-3 rounded-xl bg-muted/50 p-3 text-sm sm:grid-cols-2">
          <div className="flex items-start gap-2">
            <CalendarClock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <dt className="text-muted-foreground">{view.ending ? t('endsOn') : t('renewsOn')}</dt>
              <dd className="font-medium" data-testid="premium-period-end">
                {date}
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <RefreshCw aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <dt className="text-muted-foreground">{t('autoRenew')}</dt>
              <dd className="font-medium" data-testid="premium-auto-renew">
                {view.renewing ? t('autoRenewOn') : t('autoRenewOff')}
              </dd>
            </div>
          </div>
        </dl>
      ) : null}

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Wallet aria-hidden="true" className="size-4 shrink-0" />
        {t('balance', { coins: tw('coins', { amount: wallet.balance }) })}
      </p>

      {view.active && view.renewing && wallet.balance < view.price ? (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('lowForRenewal', { coins: tw('coins', { amount: view.shortBy }) })}
        </p>
      ) : null}

      {wallet.frozen ? (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {tw('frozen')}
        </p>
      ) : null}

      {!view.active && !view.canSubscribe ? (
        <div className="flex flex-col gap-3 rounded-xl bg-primary-soft p-3 text-primary-soft-foreground" data-testid="premium-insufficient">
          <p className="text-sm font-medium">{t('insufficient', { coins: tw('coins', { amount: view.shortBy }) })}</p>
          <Button onClick={() => setTopupOpen(true)} disabled={wallet.frozen} className="self-start">
            {t('topup')}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        {view.active ? (
          view.renewing ? (
            <Button variant="outline" onClick={() => setConfirmCancel(true)} disabled={!online}>
              {t('cancel')}
            </Button>
          ) : (
            <Button loading={action.isPending && action.variables === 'resume'} disabled={!online || wallet.frozen} onClick={() => void run('resume').catch(() => undefined)}>
              {t('resume')}
            </Button>
          )
        ) : (
          <Button size="lg" leadingIcon={<Crown aria-hidden="true" />} disabled={!online || !view.canSubscribe || wallet.frozen} onClick={() => setConfirmSubscribe(true)} data-testid="premium-subscribe">
            {t('subscribe', { price: view.price })}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmSubscribe}
        onOpenChange={setConfirmSubscribe}
        title={t('subscribeTitle')}
        description={t('subscribeDescription', { price: view.price, days: wallet.premium.periodDays || PREMIUM.periodDays })}
        confirmLabel={t('subscribeConfirm', { price: view.price })}
        onConfirm={() => run('subscribe')}
      />
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t('cancelTitle')}
        description={t('cancelDescription', { date })}
        confirmLabel={t('cancelConfirm')}
        onConfirm={() => run('cancel')}
      />
      <TopupDialog open={topupOpen} onOpenChange={setTopupOpen} initialAmount={Math.max(WALLET_LIMITS.topupMin, view.shortBy)} />
    </Card>
  );
}

function Perks({ premium }: { premium: PremiumDto }) {
  const t = useTranslations('premium.perks');
  return (
    <section aria-labelledby="premium-perks-heading" className="flex flex-col gap-3">
      <h2 id="premium-perks-heading" className="text-xl font-semibold tracking-tight">
        {t('title')}
      </h2>
      <ul className="flex flex-col overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t" data-testid="premium-perks">
        <li className="flex items-start gap-3 px-4 py-3">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-premium-soft text-premium-soft-foreground">
            <Crown className="size-5" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="font-medium">{t('badge')}</span>
            <span className="text-sm text-muted-foreground">{t('badgeHint')}</span>
          </span>
        </li>
        {PERKS.map(({ key, icon: Icon }) => (
          <li key={key} className="flex items-start gap-3 px-4 py-3" data-perk={key}>
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-premium-soft text-premium-soft-foreground">
              <Icon className="size-5" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">{t(`${key}.title`, { base: PREMIUM_PERK_LIMITS[key].base, premium: PREMIUM_PERK_LIMITS[key].premium })}</span>
              <span className="text-sm text-muted-foreground">{t('now', { value: premium.limits[key] })}</span>
            </span>
          </li>
        ))}
        <li className="flex items-start gap-3 px-4 py-3">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Siren className="size-5" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="font-medium">{t('sosFree')}</span>
            <span className="text-sm text-muted-foreground">{t('sosFreeHint')}</span>
          </span>
        </li>
      </ul>
      <p className="flex items-start gap-2 px-1 text-sm text-muted-foreground">
        <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t('keepData')}
      </p>
    </section>
  );
}
