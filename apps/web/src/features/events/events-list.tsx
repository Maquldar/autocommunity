'use client';

import { CalendarDays, CalendarX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { InfiniteList } from '@/components/ui/infinite-list';
import { useEvents, type EventScope } from './api';
import { EventCard, EventCardSkeleton } from './event-card';

/** Upcoming or past events (optionally of one community) as a list of cards. */
export function EventsList({
  scope,
  communityId = null,
  showCommunity = true,
  emptyAction,
}: {
  scope: EventScope;
  communityId?: string | null;
  showCommunity?: boolean;
  emptyAction?: ReactNode;
}) {
  const t = useTranslations('events');
  const query = useEvents(scope, communityId);
  return (
    <InfiniteList
      query={query}
      label={scope === 'upcoming' ? t('list.upcomingLabel') : t('list.pastLabel')}
      getKey={(event) => event.id}
      listClassName="flex flex-col gap-3"
      skeleton={<EventCardSkeleton />}
      skeletonCount={3}
      hideEnd={false}
      empty={
        <EmptyState
          className="rounded-2xl border bg-card"
          icon={scope === 'upcoming' ? CalendarDays : CalendarX}
          title={scope === 'upcoming' ? t('empty.upcomingTitle') : t('empty.pastTitle')}
          description={scope === 'upcoming' ? (communityId ? t('empty.communityDescription') : t('empty.upcomingDescription')) : t('empty.pastDescription')}
          action={scope === 'upcoming' ? emptyAction : undefined}
        />
      }
      renderItem={(event) => <EventCard event={event} showCommunity={showCommunity} />}
    />
  );
}
