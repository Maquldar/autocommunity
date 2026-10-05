'use client';

import { Inbox, Search, Send, UserRoundSearch, UsersRound, X } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { CountBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { InfiniteList } from '@/components/ui/infinite-list';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDebounced } from '@/hooks/use-debounced';
import { FriendButton } from './friend-button';
import { useFriendRequests, useFriendsList, useUserSearch } from './queries';
import { UserRow, UserRowSkeleton } from './user-row';

const LIST_CLASS = 'overflow-hidden rounded-2xl border bg-card';
const DIVIDED = '[&>li+li]:border-t';

type Tab = 'friends' | 'incoming' | 'outgoing';

export function FriendsView() {
  const t = useTranslations('friends');
  const [tab, setTab] = useState<Tab>('friends');
  const [input, setInput] = useState('');
  const q = useDebounced(input.trim(), 300);
  const searching = q.length >= 2;
  const incoming = useFriendRequests('in');
  const incomingCount = incoming.data?.pages[0]?.items.length ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-6">
      <PageHeader title={t('title')} description={t('description')} />

      <SearchField value={input} onChange={setInput} />

      {searching ? (
        <SearchResults q={q} />
      ) : (
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsList aria-label={t('tabsLabel')}>
            <TabsTrigger value="friends">{t('tabs.friends')}</TabsTrigger>
            <TabsTrigger value="incoming">
              {t('tabs.incoming')}
              {incomingCount > 0 ? <CountBadge aria-hidden="true" count={incomingCount} /> : null}
            </TabsTrigger>
            <TabsTrigger value="outgoing">{t('tabs.outgoing')}</TabsTrigger>
          </TabsList>
          <TabsContent value="friends">
            <FriendsTab />
          </TabsContent>
          <TabsContent value="incoming">
            <RequestsTab direction="in" />
          </TabsContent>
          <TabsContent value="outgoing">
            <RequestsTab direction="out" />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslations('friends.search');
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{t('label')}</Label>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t('placeholder')}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={`${id}-hint`}
          className="ps-10 pe-12 [&::-webkit-search-cancel-button]:hidden"
          maxLength={60}
        />
        {value ? (
          <IconButton aria-label={t('clear')} size="sm" className="absolute end-1 top-1/2 -translate-y-1/2" onClick={() => onChange('')}>
            <X />
          </IconButton>
        ) : null}
      </div>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {t('hint')}
      </p>
    </div>
  );
}

function SearchResults({ q }: { q: string }) {
  const t = useTranslations('friends.search');
  const query = useUserSearch(q);
  return (
    <section aria-labelledby="friends-search-heading" className="flex flex-col gap-3">
      <h2 id="friends-search-heading" className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('results')}
      </h2>
      <InfiniteList
        query={query}
        label={t('listLabel')}
        getKey={(user) => user.id}
        className={LIST_CLASS}
        listClassName={DIVIDED}
        skeleton={<UserRowSkeleton />}
        skeletonCount={3}
        hideEnd
        empty={<EmptyState icon={UserRoundSearch} title={t('empty')} description={t('emptyHint')} />}
        renderItem={(user) => (
          <UserRow user={user} action={<FriendButton user={{ id: user.id, name: user.name, relation: user.relation }} size="sm" />} />
        )}
      />
    </section>
  );
}

function FriendsTab() {
  const t = useTranslations('friends');
  const query = useFriendsList();
  return (
    <InfiniteList
      query={query}
      label={t('listLabel.friends')}
      getKey={(user) => user.id}
      className={LIST_CLASS}
      listClassName={DIVIDED}
      skeleton={<UserRowSkeleton />}
      skeletonCount={4}
      empty={<EmptyState icon={UsersRound} title={t('empty.friends.title')} description={t('empty.friends.description')} />}
      renderItem={(user) => (
        <UserRow user={user} action={<FriendButton user={{ id: user.id, name: user.name, relation: 'friend' }} size="sm" />} />
      )}
    />
  );
}

function RequestsTab({ direction }: { direction: 'in' | 'out' }) {
  const t = useTranslations('friends');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const query = useFriendRequests(direction);
  const key = direction === 'in' ? 'incoming' : 'outgoing';
  return (
    <InfiniteList
      query={query}
      label={t(`listLabel.${key}`)}
      getKey={(request) => request.id}
      className={LIST_CLASS}
      listClassName={DIVIDED}
      skeleton={<UserRowSkeleton />}
      skeletonCount={3}
      empty={
        <EmptyState
          icon={direction === 'in' ? Inbox : Send}
          title={t(`empty.${key}.title`)}
          description={t(`empty.${key}.description`)}
        />
      }
      renderItem={(request) => {
        const time = format.relativeTime(new Date(request.createdAt), now);
        return (
          <UserRow
            user={request.user}
            meta={direction === 'in' ? t('receivedAgo', { time }) : t('sentAgo', { time })}
            action={
              <FriendButton
                user={{ id: request.user.id, name: request.user.name, relation: direction === 'in' ? 'request_in' : 'request_out' }}
                requestId={request.id}
                size="sm"
              />
            }
          />
        );
      }}
    />
  );
}
