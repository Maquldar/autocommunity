'use client';

import type { EventDto } from '@autoc/shared';
import { Check, Lock, MapPin, Route, Star, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { calendarTile, formatEventWhen } from './time';

/** Event card (lists, community tab): calendar tile · title · when · place · community · going · my RSVP. */
export function EventCard({ event, showCommunity = true, className }: { event: EventDto; showCommunity?: boolean; className?: string }) {
  const t = useTranslations('events');
  const locale = useLocale();
  const tile = calendarTile(event.startsAt, locale);
  return (
    <Link
      href={`/events/${event.id}`}
      data-testid="event-card"
      className={cn(
        'flex items-start gap-3 rounded-2xl border bg-card p-4 shadow-sm transition-[box-shadow,border-color] duration-fast hover:border-input hover:shadow-md focus-ring',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex w-14 shrink-0 flex-col items-center overflow-hidden rounded-xl border bg-background text-center"
      >
        <span className="w-full bg-primary py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-primary-foreground">{tile.month}</span>
        <span className="py-1 text-xl font-semibold tabular-nums leading-7">{tile.day}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-base font-semibold leading-snug text-balance break-words">{event.title}</span>
        <span className="text-sm font-medium tabular-nums text-foreground">
          <time dateTime={event.startsAt}>{formatEventWhen(event.startsAt, event.endsAt, locale)}</time>
        </span>
        <span className="flex min-w-0 items-start gap-1 text-sm text-muted-foreground">
          <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words">{event.place}</span>
        </span>
        {showCommunity ? (
          <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            {event.community.isPrivate ? <Lock aria-label={t('private')} className="size-3.5 shrink-0" /> : null}
            <span className="truncate">{event.community.name}</span>
          </span>
        ) : null}
        <span className="mt-1 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground" data-testid="going-count">
            <UsersRound aria-hidden="true" className="size-4" />
            {t('goingCount', { count: event.goingCount })}
          </span>
          {event.route ? (
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <Route aria-hidden="true" className="size-4" />
              {t('hasRoute')}
            </span>
          ) : null}
          {event.myRsvp === 'going' ? (
            <Badge variant="success" size="sm" data-testid="my-rsvp">
              <Check aria-hidden="true" />
              {t('rsvp.going')}
            </Badge>
          ) : event.myRsvp === 'interested' ? (
            <Badge variant="primary" size="sm" data-testid="my-rsvp">
              <Star aria-hidden="true" />
              {t('rsvp.interested')}
            </Badge>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

export function EventCardSkeleton() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border bg-card p-4">
      <Skeleton className="h-16 w-14 rounded-xl" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-24" />
      </div>
    </div>
  );
}
