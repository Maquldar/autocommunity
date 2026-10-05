'use client';

import { SERVICE_LIMITS, type ServiceCategory } from '@autoc/shared';
import { LocateFixed, Plus, SearchX, Wrench, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { InfiniteList } from '@/components/ui/infinite-list';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { roundCoords, useServiceList } from './api';
import { ServiceCard, ServiceCardSkeleton } from './service-card';
import { usePosition } from './use-position';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

type Sort = 'distance' | 'rating';

export function ServicesList({ category, onResetCategory }: { category: ServiceCategory | undefined; onResetCategory: () => void }) {
  const t = useTranslations('services');
  const searchId = useId();
  const hintId = useId();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 300);
  const q = debounced.length >= SERVICE_LIMITS.searchMin ? debounced : undefined;
  const position = usePosition({ auto: true });
  const [sortChoice, setSortChoice] = useState<Sort>('distance');
  const at = roundCoords(position.coords);
  // Distance sort needs a position; until there is one the list is ordered by rating.
  const sort: Sort = at ? sortChoice : 'rating';
  const list = useServiceList({ category, q, sort, at });
  const filtered = Boolean(category || q);
  const showShortHint = query.trim().length > 0 && query.trim().length < SERVICE_LIMITS.searchMin;

  return (
    <section className="flex flex-col gap-3" aria-labelledby={searchId}>
      <div className="flex flex-col gap-1.5">
        <label id={searchId} htmlFor={`${searchId}-input`} className="sr-only">
          {t('search.label')}
        </label>
        <div className="relative">
          <Input
            id={`${searchId}-input`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            maxLength={SERVICE_LIMITS.searchMax}
            enterKeyHint="search"
            autoComplete="off"
            aria-describedby={showShortHint ? hintId : undefined}
            className="pe-11 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <IconButton aria-label={t('search.clear')} size="sm" variant="ghost" className="absolute end-1 top-1/2 -translate-y-1/2" onClick={() => setQuery('')}>
              <X />
            </IconButton>
          ) : null}
        </div>
        {showShortHint ? (
          <p id={hintId} className="text-sm text-muted-foreground">
            {t('search.tooShort')}
          </p>
        ) : null}
      </div>

      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2">
        {at ? (
          <SegmentedControl<Sort>
            label={t('sort.label')}
            value={sortChoice}
            onValueChange={setSortChoice}
            options={[
              { value: 'distance', label: t('sort.distance') },
              { value: 'rating', label: t('sort.rating') },
            ]}
            className="w-full sm:w-auto sm:min-w-72"
          />
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              leadingIcon={<LocateFixed aria-hidden="true" />}
              loading={position.status === 'locating'}
              onClick={() => void position.request().catch(() => undefined)}
            >
              {position.status === 'locating' ? t('location.locating') : t('location.use')}
            </Button>
            {position.status === 'denied' || position.status === 'unavailable' ? (
              <p role="status" className="min-w-0 flex-1 text-sm text-muted-foreground">
                {position.status === 'denied' ? t('location.denied') : t('location.unavailable')}
              </p>
            ) : null}
          </>
        )}
      </div>

      <InfiniteList
        query={list}
        label={t('list.label')}
        getKey={(s) => s.id}
        renderItem={(s) => <ServiceCard service={s} />}
        skeleton={<ServiceCardSkeleton />}
        skeletonCount={5}
        className="flex flex-col"
        listClassName="gap-3"
        empty={
          filtered ? (
            <EmptyState
              icon={SearchX}
              title={t('list.noMatchesTitle')}
              description={t('list.noMatchesDescription')}
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery('');
                    onResetCategory();
                  }}
                >
                  {t('list.resetFilters')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Wrench}
              title={t('list.emptyTitle')}
              description={t('list.emptyDescription')}
              action={
                <Button asChild leadingIcon={<Plus aria-hidden="true" />}>
                  <Link href="/services/new">{t('add')}</Link>
                </Button>
              }
            />
          )
        }
      />
    </section>
  );
}
