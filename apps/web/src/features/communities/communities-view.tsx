'use client';

import { CITIES } from '@autoc/shared';
import { Plus, Search, SearchX, UsersRound, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { InfiniteList } from '@/components/ui/infinite-list';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDebounced } from '@/hooks/use-debounced';
import { useCityName } from '@/features/profile/city';
import { CommunityRow, CommunityRowSkeleton } from './community-row';
import { useCommunities, useMyCommunities } from './queries';

const LIST_CLASS = 'overflow-hidden rounded-2xl border bg-card';
const DIVIDED = '[&>li+li]:border-t';
const ANY_CITY = '__any';

/** /communities — search, the viewer's communities (active + pending) and the discover list. */
export function CommunitiesView() {
  const t = useTranslations('communities');
  const [input, setInput] = useState('');
  const [city, setCity] = useState<string | null>(null);
  const q = useDebounced(input.trim(), 300);
  const filtered = q.length > 0 || city !== null;

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild size="sm" leadingIcon={<Plus aria-hidden="true" />}>
            <Link href="/communities/new">{t('create')}</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <SearchField value={input} onChange={setInput} />
        <CityFilter value={city} onChange={setCity} />
      </div>

      {filtered ? null : <MyCommunities />}
      <Discover q={q} city={city} filtered={filtered} />
    </div>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslations('communities.search');
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{t('label')}</Label>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder={t('placeholder')}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="ps-10 pe-12 [&::-webkit-search-cancel-button]:hidden"
          maxLength={60}
        />
        {value ? (
          <IconButton aria-label={t('clear')} size="sm" className="absolute end-1 top-1/2 -translate-y-1/2" onClick={() => onChange('')}>
            <X />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}

function CityFilter({ value, onChange }: { value: string | null; onChange: (city: string | null) => void }) {
  const t = useTranslations('communities.cityFilter');
  const cityName = useCityName();
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{t('label')}</Label>
      <Select value={value ?? ANY_CITY} onValueChange={(next) => onChange(next === ANY_CITY ? null : next)}>
        <SelectTrigger id={id} data-testid="city-filter">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY_CITY}>{t('any')}</SelectItem>
          {CITIES.map((c) => (
            <SelectItem key={c} value={c}>
              {cityName(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

function MyCommunities() {
  const t = useTranslations('communities');
  const mine = useMyCommunities();
  // Nothing to show yet: the discover list below is the call to action.
  if (mine.isSuccess && mine.data.length === 0) return null;
  return (
    <section aria-labelledby="my-communities-heading" className="flex flex-col gap-3">
      <SectionTitle id="my-communities-heading">{t('mine.title')}</SectionTitle>
      {mine.isPending ? (
        <div aria-busy="true" className={LIST_CLASS}>
          <span className="sr-only">{t('loading')}</span>
          <CommunityRowSkeleton />
          <CommunityRowSkeleton />
        </div>
      ) : mine.isError ? (
        <ErrorState compact className={LIST_CLASS} onRetry={() => void mine.refetch()} retrying={mine.isFetching} />
      ) : (
        <ul aria-label={t('mine.listLabel')} className={`${LIST_CLASS} ${DIVIDED}`}>
          {mine.data.map((community) => (
            <li key={community.id}>
              <CommunityRow community={community} showMembership />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Discover({ q, city, filtered }: { q: string; city: string | null; filtered: boolean }) {
  const t = useTranslations('communities');
  const query = useCommunities({ q, city });
  return (
    <section aria-labelledby="discover-heading" className="flex flex-col gap-3">
      <SectionTitle id="discover-heading">{filtered ? t('discover.searchTitle') : t('discover.title')}</SectionTitle>
      <InfiniteList
        query={query}
        label={t('discover.listLabel')}
        getKey={(community) => community.id}
        className={LIST_CLASS}
        listClassName={DIVIDED}
        skeleton={<CommunityRowSkeleton />}
        skeletonCount={5}
        empty={
          filtered ? (
            <EmptyState icon={SearchX} title={t('discover.empty.title')} description={t('discover.empty.description')} />
          ) : (
            <EmptyState
              icon={UsersRound}
              title={t('discover.emptyAll.title')}
              description={t('discover.emptyAll.description')}
              action={
                <Button asChild leadingIcon={<Plus aria-hidden="true" />}>
                  <Link href="/communities/new">{t('createCommunity')}</Link>
                </Button>
              }
            />
          )
        }
        renderItem={(community) => <CommunityRow community={community} showMembership />}
      />
    </section>
  );
}
