'use client';

import type { CommunityDto } from '@autoc/shared';
import { CalendarPlus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { EventScope } from './api';
import { EventsList } from './events-list';

/** The community page's Events tab: upcoming / past, and "Create event" for owners and moderators. */
export function CommunityEventsPanel({ community }: { community: CommunityDto }) {
  const t = useTranslations('events');
  const [scope, setScope] = useState<EventScope>('upcoming');
  const m = community.myMembership;
  const canCreate = m?.status === 'active' && (m.role === 'owner' || m.role === 'moderator');
  const create = canCreate ? (
    <Button asChild leadingIcon={<CalendarPlus aria-hidden="true" />} data-testid="create-event">
      <Link href={`/communities/${community.id}/events/new`}>{t('create')}</Link>
    </Button>
  ) : null;
  return (
    <div className="flex flex-col gap-4 pt-2" data-testid="community-events">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label={t('list.when')}
          value={scope}
          onValueChange={setScope}
          options={[
            { value: 'upcoming', label: t('list.upcoming') },
            { value: 'past', label: t('list.past') },
          ]}
        />
        {create}
      </div>
      <EventsList scope={scope} communityId={community.id} showCommunity={false} />
    </div>
  );
}
