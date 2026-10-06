'use client';

import { UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMyCommunities } from '@/features/communities/queries';
import type { EventScope } from './api';
import { EventsList } from './events-list';

const ALL = '__all';
const SCOPE_KEY = 'autoc:events-scope';

/** /events — upcoming / past, filtered by one of the viewer's communities. */
export function EventsView() {
  const t = useTranslations('events');
  const [scope, setScope] = useState<EventScope>('upcoming');
  const [communityId, setCommunityId] = useState<string | null>(null);
  const communities = useMyCommunities();
  const active = communities.data?.filter((c) => c.myMembership?.status === 'active') ?? [];
  const selectId = useId();

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(SCOPE_KEY) === 'past') setScope('past');
    } catch {
      // per-tab convenience only
    }
  }, []);
  const changeScope = (next: EventScope) => {
    setScope(next);
    try {
      window.sessionStorage.setItem(SCOPE_KEY, next);
    } catch {
      // ignore
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-5">
      <PageHeader title={t('title')} description={t('description')} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-end">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium" id={`${selectId}-scope`}>
            {t('list.when')}
          </span>
          <SegmentedControl
            label={t('list.when')}
            value={scope}
            onValueChange={changeScope}
            options={[
              { value: 'upcoming', label: t('list.upcoming') },
              { value: 'past', label: t('list.past') },
            ]}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={selectId}>{t('list.community')}</Label>
          <Select value={communityId ?? ALL} onValueChange={(v) => setCommunityId(v === ALL ? null : v)}>
            <SelectTrigger id={selectId} data-testid="events-community-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('list.allCommunities')}</SelectItem>
              {active.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <EventsList
        scope={scope}
        communityId={communityId}
        emptyAction={
          <Button asChild variant="secondary" leadingIcon={<UsersRound aria-hidden="true" />}>
            <Link href="/communities">{t('empty.findCommunities')}</Link>
          </Button>
        }
      />
    </div>
  );
}
