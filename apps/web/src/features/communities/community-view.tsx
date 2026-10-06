'use client';

import type { CommunityDto } from '@autoc/shared';
import { ArrowLeft, Lock, MapPin, SearchX, Settings, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CountBadge } from '@/components/ui/badge';
import { useErrorMessage } from '@/hooks/use-error-message';
import { hasErrorCode } from '@/lib/api/errors';
import { useCityName } from '@/features/profile/city';
import { CommunityChatPreview } from './community-chat-preview';
import { PrivacyBadge } from './community-row';
import { CommunitySettingsSheet } from './community-settings';
import { MembersList, RequestsList } from './members-panel';
import { MembershipButton } from './membership-button';
import { communityPermissions } from './membership-state';
import { useCommunity, useCommunityMembers } from './queries';
import { CommunityEventsPanel } from '@/features/events/community-events-panel';
import { CommunityFeedPanel } from '@/features/feed/community-feed-panel';

export type CommunityTab = 'chat' | 'members' | 'requests' | 'events' | 'feed';

/** /communities/[id] (and /communities/[id]/requests): header, membership, tabs, settings. */
export function CommunityView({ id, initialTab }: { id: string; initialTab?: CommunityTab }) {
  const t = useTranslations('communities');
  const errorMessage = useErrorMessage();
  const query = useCommunity(id);

  if (query.isPending) return <CommunitySkeleton label={t('loading')} />;
  if (query.isError) {
    if (hasErrorCode(query.error, 'NOT_FOUND') || hasErrorCode(query.error, 'VALIDATION_ERROR')) {
      return (
        <EmptyState
          icon={SearchX}
          title={t('notFound.title')}
          description={t('notFound.description')}
          action={
            <Button asChild>
              <Link href="/communities">{t('notFound.back')}</Link>
            </Button>
          }
        />
      );
    }
    return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }
  return <CommunityPage community={query.data} initialTab={initialTab} />;
}

function CommunityPage({ community, initialTab }: { community: CommunityDto; initialTab?: CommunityTab }) {
  const t = useTranslations('communities');
  const permissions = communityPermissions(community);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const available: CommunityTab[] = [
    ...(permissions.isMember ? (['chat'] as const) : []),
    'events',
    'feed',
    'members',
    ...(permissions.canSeeRequests ? (['requests'] as const) : []),
  ];
  const fallback: CommunityTab = permissions.isMember ? 'chat' : 'members';
  const [tab, setTab] = useState<CommunityTab>(initialTab && available.includes(initialTab) ? initialTab : fallback);
  // Membership changes (approved, left, demoted) can remove the current tab.
  const current = available.includes(tab) ? tab : fallback;
  useEffect(() => {
    if (initialTab && available.includes(initialTab)) setTab(initialTab);
    // Only when the requested tab becomes available (e.g. after the role loads).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab, available.join()]);

  // Becoming a member (joined, or approved live) opens the chat tab.
  const wasMember = useRef(permissions.isMember);
  useEffect(() => {
    if (permissions.isMember && !wasMember.current) setTab('chat');
    wasMember.current = permissions.isMember;
  }, [permissions.isMember]);

  const pending = useCommunityMembers(community.id, 'pending', permissions.canSeeRequests);
  const pendingCount = pending.data?.pages[0]?.items.length ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-6">
      <CommunityHeader community={community} onOpenSettings={permissions.isModerator ? () => setSettingsOpen(true) : undefined} />

      {!permissions.canSeeMembers ? (
        <LockedPanel pending={community.myMembership?.status === 'pending'} />
      ) : (
        <Tabs value={current} onValueChange={(value) => setTab(value as CommunityTab)}>
          <TabsList aria-label={t('tabs.label')}>
            {permissions.isMember ? <TabsTrigger value="chat">{t('tabs.chat')}</TabsTrigger> : null}
            <TabsTrigger value="events">{t('tabs.events')}</TabsTrigger>
            <TabsTrigger value="feed">{t('tabs.feed')}</TabsTrigger>
            <TabsTrigger value="members">{t('tabs.members')}</TabsTrigger>
            {permissions.canSeeRequests ? (
              <TabsTrigger value="requests">
                {t('tabs.requests')}
                {pendingCount > 0 ? <CountBadge aria-hidden="true" count={pendingCount} /> : null}
              </TabsTrigger>
            ) : null}
          </TabsList>
          {permissions.isMember ? (
            <TabsContent value="chat">
              <CommunityChatPreview community={community} />
            </TabsContent>
          ) : null}
          <TabsContent value="events">
            <CommunityEventsPanel community={community} />
          </TabsContent>
          <TabsContent value="feed">
            <CommunityFeedPanel community={community} />
          </TabsContent>
          <TabsContent value="members">
            <MembersList community={community} />
          </TabsContent>
          {permissions.canSeeRequests ? (
            <TabsContent value="requests">
              <RequestsList community={community} />
            </TabsContent>
          ) : null}
        </Tabs>
      )}

      {permissions.isModerator ? (
        <CommunitySettingsSheet community={community} open={settingsOpen} onOpenChange={setSettingsOpen} />
      ) : null}
    </div>
  );
}

/**
 * Community header: back link, square avatar, name (h1), privacy · members · city, description, and the
 * membership action (+ settings for moderators).
 */
function CommunityHeader({ community, onOpenSettings }: { community: CommunityDto; onOpenSettings?: () => void }) {
  const t = useTranslations();
  const cityName = useCityName();
  return (
    <header className="flex flex-col gap-4 pt-2" data-testid="community-header">
      <div className="flex items-start gap-3">
        <IconButton asChild aria-label={t('common.back')} className="-ms-2 shrink-0">
          <Link href="/communities">
            <ArrowLeft className="rtl:rotate-180" />
          </Link>
        </IconButton>
        <Avatar id={community.id} name={community.name} src={community.avatarUrl} shape="square" size="lg" decorative />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 className="text-2xl font-semibold leading-8 tracking-tight text-balance break-words">{community.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
            <PrivacyBadge isPrivate={community.isPrivate} />
            <span className="inline-flex items-center gap-1" data-testid="member-count">
              <UsersRound aria-hidden="true" className="size-4" />
              {t('communities.members', { count: community.memberCount })}
            </span>
            {community.city ? (
              <span className="inline-flex items-center gap-1">
                <MapPin aria-hidden="true" className="size-4" />
                {cityName(community.city)}
              </span>
            ) : null}
          </div>
        </div>
        {onOpenSettings ? (
          <IconButton aria-label={t('communities.actions.settings')} variant="ghost" className="shrink-0" onClick={onOpenSettings}>
            <Settings />
          </IconButton>
        ) : null}
      </div>
      {community.description ? (
        <p className="whitespace-pre-line break-words text-[0.9375rem] text-pretty text-foreground">{community.description}</p>
      ) : null}
      <MembershipButton community={community} className="max-sm:w-full sm:self-start" />
    </header>
  );
}

function LockedPanel({ pending }: { pending: boolean }) {
  const t = useTranslations('communities.locked');
  return (
    <section className="rounded-2xl border bg-card" data-testid="community-locked">
      <EmptyState icon={Lock} title={t('title')} description={pending ? t('pendingDescription') : t('description')} />
    </section>
  );
}

function CommunitySkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-narrow flex-col gap-6 pt-2">
      <span className="sr-only">{label}</span>
      <div className="flex items-start gap-3">
        <Skeleton className="size-11 rounded-full" />
        <Skeleton className="size-14 rounded-xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-11 w-40 rounded-lg" />
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  );
}
