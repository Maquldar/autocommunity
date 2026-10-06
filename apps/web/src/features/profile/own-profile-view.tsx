'use client';

import { CarFront, Crown, Handshake, Pencil, Siren, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ListGroup, ListItem } from '@/components/ui/list-item';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCurrentUser } from '@/lib/auth/guards';
import { RatingHistory, RatingSummary, ReviewsList } from '@/features/rating/rating-views';
import { ReceivedVotes } from '@/features/votes/vote-panel';
import { useWallet } from '@/features/wallet/api';
import { MyVehicles } from './my-vehicles';
import { ProfileHeader } from './profile-header';

export type OwnProfileTab = 'overview' | 'votes';

const tile = (className: string, icon: ReactNode) => (
  <span aria-hidden="true" className={`flex size-10 items-center justify-center rounded-xl ${className}`}>
    {icon}
  </span>
);

export function OwnProfileView({ initialTab = 'overview' }: { initialTab?: OwnProfileTab }) {
  const t = useTranslations('profile');
  const me = useCurrentUser();
  const [tab, setTab] = useState<OwnProfileTab>(initialTab);
  const tabParam = useSearchParams().get('tab');
  // A link to /profile?tab=votes while already here (toast "Open") switches the tab too.
  useEffect(() => {
    setTab(tabParam === 'votes' ? 'votes' : 'overview');
  }, [tabParam]);

  const changeTab = (value: string) => {
    const next: OwnProfileTab = value === 'votes' ? 'votes' : 'overview';
    setTab(next);
    // `/profile?tab=votes` is where the vote_received push lands; keep the URL in step.
    const url = new URL(window.location.href);
    if (next === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', url);
  };

  return (
    <div className="flex flex-col gap-8">
      <ProfileHeader
        user={me}
        actions={
          <Button asChild variant="outline" leadingIcon={<Pencil aria-hidden="true" />}>
            <Link href="/profile/edit">{t('edit')}</Link>
          </Button>
        }
      />
      {me.bio ? null : (
        <p className="-mt-4 px-1 text-sm text-muted-foreground">
          {t.rich('noBio', {
            link: (chunks) => (
              <Link href="/profile/edit" className="font-medium text-primary underline-offset-4 hover:underline focus-ring rounded-sm">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList aria-label={t('tabs.label')}>
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="votes" data-testid="profile-votes-tab">
            {t('tabs.votes')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-6 flex flex-col gap-8">
          <RatingSummary userId={me.id} self name={me.name} />
          <ListGroup>
            <WalletRow />
            <ListItem
              href="/premium"
              leading={tile('bg-premium-soft text-premium-soft-foreground', <Crown className="size-5" />)}
              title={t('premiumLink')}
              description={me.isPremium ? t('premiumActive') : t('premiumHint')}
            />
            <ListItem href="/friends" leading={tile('bg-primary-soft text-primary-soft-foreground', <Handshake className="size-5" />)} title={t('friendsLink')} description={t('friendsLinkHint')} />
            <ListItem href="/sos/history" leading={tile('bg-sos-soft text-sos-soft-foreground', <Siren className="size-5" />)} title={t('sosHistoryLink')} description={t('sosHistoryHint')} />
            <ListItem href="/settings/violations" leading={tile('bg-muted text-muted-foreground', <CarFront className="size-5" />)} title={t('violationsLink')} description={t('violationsHint')} />
          </ListGroup>
          <MyVehicles />
          <ReviewsList userId={me.id} self />
          <RatingHistory />
        </TabsContent>
        <TabsContent value="votes" className="mt-6">
          <ReceivedVotes userId={me.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** The balance on the profile, linking to /wallet. */
function WalletRow() {
  const t = useTranslations('profile');
  const tw = useTranslations('wallet');
  const wallet = useWallet();
  const description = wallet.data ? tw('coins', { amount: wallet.data.balance }) : wallet.isError ? t('walletHint') : '…';
  return (
    <ListItem
      href="/wallet"
      leading={tile('bg-primary-soft text-primary-soft-foreground', <Wallet className="size-5" />)}
      title={t('walletLink')}
      description={<span data-testid="profile-balance" data-balance={wallet.data?.balance}>{description}</span>}
      trailing={wallet.data?.frozen ? <span className="text-sm text-warning">{t('walletFrozen')}</span> : undefined}
    />
  );
}
