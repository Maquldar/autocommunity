'use client';

import type { Paginated } from '@autoc/shared';
import type { InfiniteData } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { ErrorState } from './error-state';
import { Spinner } from './spinner';

/** The subset of `useInfiniteQuery()`'s result this component needs. Pass the query object directly. */
export type InfiniteListQuery<T> = {
  data: InfiniteData<Paginated<T>, unknown> | undefined;
  status: 'pending' | 'error' | 'success';
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  isRefetching: boolean;
  fetchNextPage: () => unknown;
  refetch: () => unknown;
};

export type InfiniteListProps<T> = {
  query: InfiniteListQuery<T>;
  renderItem: (item: T, index: number) => ReactNode;
  getKey: (item: T) => string;
  /** One skeleton row shaped like the real item; repeated `skeletonCount` times while loading. */
  skeleton: ReactNode;
  skeletonCount?: number;
  /** Shown when the first page is empty — usually an <EmptyState>. */
  empty: ReactNode;
  /** Accessible name for the list. */
  label: string;
  /** Hide the "That's everything" footer (e.g. for short lists). */
  hideEnd?: boolean;
  className?: string;
  /** Applied to the <ul>; use `[&>li+li]:border-t` for divided lists. */
  listClassName?: string;
  /** Distance before the end at which the next page starts loading. */
  rootMargin?: string;
};

/**
 * Cursor-paginated list driven by TanStack `useInfiniteQuery`.
 * An IntersectionObserver sentinel loads the next page; a "Load more" button is the fallback
 * when IntersectionObserver is unavailable. Handles loading / empty / error / end states.
 */
export function InfiniteList<T>({
  query,
  renderItem,
  getKey,
  skeleton,
  skeletonCount = 6,
  empty,
  label,
  hideEnd = false,
  className,
  listClassName,
  rootMargin = '600px 0px',
}: InfiniteListProps<T>) {
  const t = useTranslations();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [observerSupported, setObserverSupported] = useState(true);
  const { data, status, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, refetch } = query;
  const canAutoLoad = hasNextPage && !isFetchingNextPage && !isFetchNextPageError;

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setObserverSupported(false);
      return;
    }
    const node = sentinelRef.current;
    if (!node || !canAutoLoad) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage();
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canAutoLoad, fetchNextPage, rootMargin]);

  if (status === 'pending') {
    return (
      <div aria-busy="true" className={className}>
        <span className="sr-only">{t('states.loading')}</span>
        {Array.from({ length: skeletonCount }, (_, i) => (
          <Fragment key={i}>{skeleton}</Fragment>
        ))}
      </div>
    );
  }

  if (status === 'error') {
    return <ErrorState className={className} onRetry={() => void refetch()} retrying={query.isRefetching} />;
  }

  const items = data?.pages.flatMap((page) => page.items) ?? [];
  if (items.length === 0) return <div className={className}>{empty}</div>;

  return (
    <div className={className} aria-busy={isFetchingNextPage || undefined}>
      <ul aria-label={label} className={cn('flex flex-col', listClassName)}>
        {items.map((item, index) => (
          <li key={getKey(item)}>{renderItem(item, index)}</li>
        ))}
      </ul>

      <div ref={sentinelRef} aria-hidden="true" className="h-px" />

      {isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Spinner label={t('states.loadingMore')} />
        </div>
      ) : isFetchNextPageError ? (
        <ErrorState compact title={t('errors.loadMoreFailed')} onRetry={() => void fetchNextPage()} />
      ) : hasNextPage && !observerSupported ? (
        <div className="flex justify-center py-4">
          <Button variant="outline" onClick={() => void fetchNextPage()}>
            {t('common.loadMore')}
          </Button>
        </div>
      ) : !hasNextPage && !hideEnd ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('states.end')}</p>
      ) : null}
    </div>
  );
}
