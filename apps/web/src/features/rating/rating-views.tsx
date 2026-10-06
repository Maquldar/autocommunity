'use client';

import { tierForRating, type RatingEventDto, type ReviewDto } from '@autoc/shared';
import { Check, ChevronRight, History, Lock, MessageSquareQuote, Star } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { InfiniteList } from '@/components/ui/infinite-list';
import { RatingBadge } from '@/components/ui/rating-badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ListItemSkeleton, Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { tierRanges } from '@/lib/tier';
import { TierBadge, UserAvatar } from '@/components/ui/user-avatar';
import { useRating, useRatingEvents, useReviews } from './api';
import { breakdownRows, formatPoints, unlocks } from './breakdown';

/**
 * Trust rating row on a profile: the badge plus "How is it calculated?" opening the breakdown sheet
 * (base, help, reviews, activity, tenure, penalties) with plain-language explanations and what it unlocks.
 */
export function RatingSummary({ userId, self, name }: { userId: string; self: boolean; name: string }) {
  const t = useTranslations('rating.sheet');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl border bg-card p-4 text-start hover:bg-accent focus-ring"
        data-testid="rating-summary"
      >
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
          <Star className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[0.9375rem] font-medium">{self ? t('openSelf') : t('openOther', { name })}</span>
          <span className="text-sm text-muted-foreground">{t('openHint')}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground rtl:rotate-180" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent data-testid="rating-sheet">{open ? <RatingSheetBody userId={userId} self={self} name={name} /> : null}</SheetContent>
      </Sheet>
    </>
  );
}

function RatingSheetBody({ userId, self, name }: { userId: string; self: boolean; name: string }) {
  const t = useTranslations('rating.sheet');
  const locale = useLocale();
  const query = useRating(userId, self);

  return (
    <>
      <SheetHeader>
        <SheetTitle>{self ? t('titleSelf') : t('titleOther', { name })}</SheetTitle>
        <SheetDescription>{t('description')}</SheetDescription>
      </SheetHeader>
      {query.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-10 w-32" />
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState compact onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : (
        <>
          <div className="flex items-center gap-3" data-testid="rating-value" data-rating={query.data.rating}>
            <span className="text-4xl font-bold tabular-nums tracking-tight">{query.data.rating}</span>
            <div className="flex flex-col gap-1">
              <RatingBadge rating={query.data.rating} showLabel />
              <span className="text-sm text-muted-foreground">{t('outOf')}</span>
            </div>
          </div>
          <ul className="flex flex-col gap-3" aria-label={t('breakdownLabel')}>
            {breakdownRows(query.data.breakdown).map((row) => (
              <li key={row.key} className="flex flex-col gap-1" data-testid={`rating-row-${row.key}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{t(`components.${row.key}.label`)}</span>
                  <span
                    className={cn(
                      'shrink-0 font-semibold tabular-nums',
                      row.sign === 'negative' ? 'text-danger' : row.sign === 'positive' && row.key !== 'base' ? 'text-success' : 'text-foreground',
                    )}
                  >
                    {row.key === 'base' ? String(row.value) : formatPoints(row.value, locale)}
                  </span>
                </div>
                <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full', row.sign === 'negative' ? 'bg-danger' : 'bg-primary')}
                    style={{ width: `${Math.round(row.fill * 100)}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground text-pretty">{t(`components.${row.key}.hint`)}</p>
              </li>
            ))}
          </ul>
          <TierLegend rating={query.data.rating} />
          <section className="flex flex-col gap-2 rounded-2xl border bg-card p-4" aria-label={t('unlocksLabel')}>
            <p className="font-medium">{self ? t('unlocksSelf') : t('unlocksOther')}</p>
            <ul className="flex flex-col gap-2">
              {unlocks(query.data).map((u) => (
                <li key={u.key} className="flex items-start gap-2 text-sm" data-unlocked={u.unlocked}>
                  {u.unlocked ? (
                    <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span>
                    {t(`unlocks.${u.key}`, { min: u.min })}
                    <span className="text-muted-foreground"> · {u.unlocked ? t('unlocked') : t('locked')}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

/** The rating tiers with their ranges; the current one is marked (word + check, not colour alone). */
export function TierLegend({ rating }: { rating: number }) {
  const t = useTranslations('tiers');
  const current = tierForRating(rating);
  return (
    <section className="flex flex-col gap-2 rounded-2xl border bg-card p-4" aria-labelledby="tier-legend-heading" data-testid="tier-legend">
      <h3 id="tier-legend-heading" className="font-medium">
        {t('legendTitle')}
      </h3>
      <p className="text-sm text-muted-foreground">{t('legendHint')}</p>
      <ul className="flex flex-col gap-1.5">
        {tierRanges()
          .slice()
          .reverse()
          .map((r) => (
            <li key={r.tier} className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm', r.tier === current && 'bg-muted')} data-tier={r.tier} data-current={r.tier === current || undefined}>
              {r.tier === 'none' ? <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-2 text-xs font-semibold text-muted-foreground">—</span> : <TierBadge tier={r.tier} />}
              <span className="text-muted-foreground tabular-nums">{t('range', { min: r.min, max: r.max })}</span>
              {r.tier === 'none' ? <span className="text-muted-foreground">{t('name.none')}</span> : null}
              {r.tier === current ? (
                <span className="ms-auto inline-flex items-center gap-1 font-medium">
                  <Check aria-hidden="true" className="size-4 text-success" />
                  {t('current')}
                </span>
              ) : null}
            </li>
          ))}
      </ul>
    </section>
  );
}

function EventRow({ event }: { event: RatingEventDto }) {
  const t = useTranslations('rating.history');
  const format = useFormatter();
  const locale = useLocale();
  const href = event.refId && event.reason === 'help_confirmed' ? `/sos/${event.refId}` : null;
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[0.9375rem] font-medium">{t(`reasons.${event.reason}`)}</span>
        <time dateTime={event.createdAt} className="text-sm text-muted-foreground">
          {format.dateTime(new Date(event.createdAt), { dateStyle: 'medium' })}
        </time>
      </span>
      <span className={cn('shrink-0 font-semibold tabular-nums', event.delta < 0 ? 'text-danger' : event.delta > 0 ? 'text-success' : 'text-muted-foreground')}>
        {formatPoints(event.delta, locale)}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-accent focus-ring focus-visible:-outline-offset-2">
      {body}
    </Link>
  ) : (
    <div className="flex items-center gap-3 px-4 py-3" data-testid="rating-event">
      {body}
    </div>
  );
}

/** Own profile: the private rating ledger (GET /me/rating/events). */
export function RatingHistory() {
  const t = useTranslations('rating.history');
  const query = useRatingEvents();
  return (
    <section aria-labelledby="rating-history-heading" className="flex flex-col gap-3">
      <h2 id="rating-history-heading" className="text-xl font-semibold tracking-tight">
        {t('title')}
      </h2>
      <p className="-mt-1 text-sm text-muted-foreground">{t('description')}</p>
      <InfiniteList
        query={query}
        label={t('title')}
        getKey={(e) => e.id}
        renderItem={(e) => <EventRow event={e} />}
        skeleton={<ListItemSkeleton />}
        skeletonCount={2}
        hideEnd
        listClassName="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t"
        empty={<EmptyState icon={History} title={t('empty.title')} description={t('empty.body')} className="rounded-2xl border bg-card py-8" />}
      />
    </section>
  );
}

export function Stars({ value, size = 'sm' }: { value: number; size?: 'sm' | 'md' }) {
  const t = useTranslations('rating.reviews');
  return (
    <span role="img" aria-label={t('starsLabel', { stars: value })} className="inline-flex items-center gap-0.5 text-warning">
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} aria-hidden="true" className={cn(size === 'sm' ? 'size-4' : 'size-5', i < value ? 'fill-current' : 'text-input')} />
      ))}
    </span>
  );
}

function ReviewRow({ review }: { review: ReviewDto }) {
  const format = useFormatter();
  const name = review.author.name || `@${review.author.nickname}`;
  return (
    <article className="flex gap-3 px-4 py-3" data-testid="review">
      <Link href={`/u/${review.author.id}`} tabIndex={-1} aria-hidden="true">
        <UserAvatar user={{ ...review.author, name: name }} size="md" decorative />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/u/${review.author.id}`} className="font-medium hover:underline focus-ring rounded-sm break-words">
            {name}
          </Link>
          <Stars value={review.stars} />
        </div>
        {review.comment ? <p className="whitespace-pre-line break-words text-[0.9375rem]">{review.comment}</p> : null}
        <time dateTime={review.createdAt} className="text-sm text-muted-foreground">
          {format.dateTime(new Date(review.createdAt), { dateStyle: 'medium' })}
        </time>
      </div>
    </article>
  );
}

/** Public reviews (GET /users/:id/reviews), newest first. */
export function ReviewsList({ userId, self }: { userId: string; self: boolean }) {
  const t = useTranslations('rating.reviews');
  const query = useReviews(userId);
  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="flex scroll-mt-20 flex-col gap-3" data-testid="reviews-section">
      <h2 id="reviews-heading" className="text-xl font-semibold tracking-tight">
        {t('title')}
      </h2>
      <InfiniteList
        query={query}
        label={t('title')}
        getKey={(r) => r.id}
        renderItem={(r) => <ReviewRow review={r} />}
        skeleton={<ListItemSkeleton />}
        skeletonCount={2}
        hideEnd
        listClassName="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t"
        empty={
          <EmptyState
            icon={MessageSquareQuote}
            title={t('empty.title')}
            description={self ? t('empty.bodySelf') : t('empty.body')}
            className="rounded-2xl border bg-card py-8"
          />
        }
      />
    </section>
  );
}
