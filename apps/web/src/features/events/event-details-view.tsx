'use client';

import type { EventDto, RsvpStatus } from '@autoc/shared';
import { eventEndsAt } from '@autoc/shared';
import {
  CalendarDays,
  CalendarPlus,
  Check,
  Clock,
  Lock,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Navigation,
  Pencil,
  Route,
  SearchX,
  Star,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { InfiniteList } from '@/components/ui/infinite-list';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton, ListItemSkeleton } from '@/components/ui/skeleton';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { hasErrorCode } from '@/lib/api/errors';
import { notify } from '@/lib/toast';
import { useDeleteEvent, useEvent, useEventParticipants, useRsvp } from './api';
import { EventMap } from './event-map';
import { useEventErrorMessage } from './errors';
import { downloadIcs } from './ics';
import { formatEventWhen } from './time';

/** /events/[id] */
export function EventDetailsView({ id }: { id: string }) {
  const t = useTranslations('events');
  const errorMessage = useEventErrorMessage();
  const query = useEvent(id);

  if (query.isPending) return <EventSkeleton label={t('loading')} />;
  if (query.isError) {
    if (hasErrorCode(query.error, 'NOT_FOUND') || hasErrorCode(query.error, 'VALIDATION_ERROR')) {
      return (
        <EmptyState
          icon={SearchX}
          title={t('notFound.title')}
          description={t('notFound.description')}
          action={
            <Button asChild>
              <Link href="/events">{t('notFound.back')}</Link>
            </Button>
          }
        />
      );
    }
    return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }
  return <EventPage event={query.data} />;
}

function EventPage({ event }: { event: EventDto }) {
  const t = useTranslations('events');
  const locale = useLocale();
  const ended = eventEndsAt(event).getTime() <= Date.now();
  const place = { lat: event.lat, lng: event.lng };
  const mapsHref = `https://www.openstreetmap.org/?mlat=${event.lat}&mlon=${event.lng}#map=15/${event.lat}/${event.lng}`;

  return (
    <article className="mx-auto flex w-full max-w-narrow flex-col gap-5" data-testid="event-details">
      <PageHeader
        back="/events"
        title={event.title}
        actions={event.canManage ? <ManageMenu event={event} /> : null}
        className="pb-0"
      />

      <div className="flex flex-col gap-2 text-[0.9375rem]">
        <Link href={`/communities/${event.community.id}?tab=events`} className="inline-flex min-w-0 items-center gap-2 self-start rounded-lg focus-ring">
          <Avatar id={event.community.id} name={event.community.name} src={event.community.avatarUrl} shape="square" size="xs" decorative />
          <span className="truncate font-medium text-primary underline-offset-4 hover:underline">{event.community.name}</span>
          {event.community.isPrivate ? (
            <Badge variant="neutral" size="sm">
              <Lock aria-hidden="true" />
              {t('private')}
            </Badge>
          ) : null}
        </Link>
        <p className="flex items-start gap-2">
          <Clock aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <time dateTime={event.startsAt} className="font-medium tabular-nums" data-testid="event-when">
            {formatEventWhen(event.startsAt, event.endsAt, locale)}
          </time>
          {ended ? (
            <Badge variant="neutral" size="sm" className="ms-1">
              {t('ended')}
            </Badge>
          ) : null}
        </p>
        <p className="flex items-start gap-2">
          <MapPin aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words" data-testid="event-place">
            {event.place}
            {event.distanceM !== null ? (
              <span className="text-muted-foreground"> · {event.distanceM < 1000 ? t('distanceM', { m: Math.max(10, Math.round(event.distanceM / 10) * 10) }) : t('distance', { km: Math.round(event.distanceM / 100) / 10 })}</span>
            ) : null}
          </span>
        </p>
        <p className="flex items-center gap-2 text-muted-foreground">
          <UsersRound aria-hidden="true" className="size-5 shrink-0" />
          <span data-testid="event-counts">
            {t('goingCount', { count: event.goingCount })} · {t('interestedCount', { count: event.interestedCount })}
          </span>
        </p>
      </div>

      <RsvpPanel event={event} ended={ended} />

      <section aria-labelledby="event-map-heading" className="flex flex-col gap-2">
        <h2 id="event-map-heading" className="flex items-center gap-2 text-lg font-semibold">
          {event.route ? <Route aria-hidden="true" className="size-5 text-muted-foreground" /> : <MapPin aria-hidden="true" className="size-5 text-muted-foreground" />}
          {event.route ? t('details.routeTitle', { count: event.route.length }) : t('details.placeTitle')}
        </h2>
        <EventMap
          place={place}
          route={event.route ?? []}
          label={t('details.mapLabel')}
          placeLabel={t('details.placeMarker', { place: event.place })}
          className="h-64 sm:h-80"
          fitOnChange
        />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" leadingIcon={<Navigation aria-hidden="true" />}>
            <a href={mapsHref} target="_blank" rel="noopener noreferrer">
              {t('details.openInMaps')}
            </a>
          </Button>
          <Button
            variant="outline"
            size="sm"
            leadingIcon={<CalendarPlus aria-hidden="true" />}
            onClick={() => downloadIcs(event, `${window.location.origin}/events/${event.id}`)}
            data-testid="add-to-calendar"
          >
            {t('details.addToCalendar')}
          </Button>
        </div>
      </section>

      {event.description ? (
        <section aria-labelledby="event-about-heading" className="flex flex-col gap-2">
          <h2 id="event-about-heading" className="text-lg font-semibold">
            {t('details.about')}
          </h2>
          <p className="whitespace-pre-line break-words text-[0.9375rem] text-pretty">{event.description}</p>
        </section>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {t('details.organizer')}{' '}
        <Link href={`/u/${event.createdBy.id}`} className="font-medium text-foreground underline-offset-4 hover:underline focus-ring">
          {event.createdBy.name || `@${event.createdBy.nickname}`}
        </Link>
      </p>

      <Participants event={event} />
    </article>
  );
}

function RsvpPanel({ event, ended }: { event: EventDto; ended: boolean }) {
  const t = useTranslations('events');
  const tc = useTranslations('common');
  const online = useOnlineStatus();
  const errorMessage = useEventErrorMessage();
  const rsvp = useRsvp(event.id);
  const set = (status: RsvpStatus | 'none') =>
    rsvp.mutate(status, {
      onSuccess: (next) => {
        if (status === 'going' && next.chatId) notify.success(t('rsvp.goingToast'));
      },
      onError: (error) => notify.error(errorMessage(error), { retry: { label: tc('retry'), onClick: () => set(status) } }),
    });
  const pending = rsvp.isPending ? rsvp.variables : null;
  const full = event.goingCount >= 500 && event.myRsvp !== 'going';

  if (ended) {
    return (
      <p className="rounded-2xl border bg-muted px-4 py-3 text-sm text-muted-foreground" role="status">
        {t('rsvp.endedNote')}
      </p>
    );
  }

  return (
    <section aria-label={t('rsvp.label')} className="flex flex-col gap-3 rounded-2xl border bg-card p-4" data-testid="rsvp-panel">
      <p className="text-sm font-medium" role="status" data-testid="rsvp-state">
        {event.myRsvp === 'going' ? t('rsvp.youAreGoing') : event.myRsvp === 'interested' ? t('rsvp.youAreInterested') : t('rsvp.question')}
      </p>
      <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
        <Button
          variant={event.myRsvp === 'going' ? 'primary' : 'outline'}
          aria-pressed={event.myRsvp === 'going'}
          leadingIcon={<Check aria-hidden="true" />}
          loading={pending === 'going'}
          disabled={!online || rsvp.isPending || full}
          onClick={() => set(event.myRsvp === 'going' ? 'none' : 'going')}
        >
          {t('rsvp.going')}
        </Button>
        <Button
          variant={event.myRsvp === 'interested' ? 'secondary' : 'outline'}
          aria-pressed={event.myRsvp === 'interested'}
          leadingIcon={<Star aria-hidden="true" />}
          loading={pending === 'interested'}
          disabled={!online || rsvp.isPending}
          onClick={() => set(event.myRsvp === 'interested' ? 'none' : 'interested')}
        >
          {t('rsvp.interested')}
        </Button>
      </div>
      {full ? <p className="text-sm text-muted-foreground">{t('errors.full')}</p> : null}
      {event.myRsvp ? (
        <Button variant="ghost" size="sm" className="self-start" leadingIcon={<X aria-hidden="true" />} loading={pending === 'none'} disabled={!online || rsvp.isPending} onClick={() => set('none')}>
          {t('rsvp.cancel')}
        </Button>
      ) : null}
      {event.chatId ? (
        <Button asChild fullWidth leadingIcon={<MessageCircle aria-hidden="true" />} data-testid="event-chat-link">
          <Link href={`/chats/${event.chatId}`}>{t('rsvp.openChat')}</Link>
        </Button>
      ) : event.myRsvp !== 'going' ? (
        <p className="text-sm text-muted-foreground">{t('rsvp.chatHint')}</p>
      ) : null}
    </section>
  );
}

function ManageMenu({ event }: { event: EventDto }) {
  const t = useTranslations('events');
  const tc = useTranslations('common');
  const router = useRouter();
  const errorMessage = useEventErrorMessage();
  const remove = useDeleteEvent(event.id);
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label={t('manage.menu')} variant="ghost">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/events/${event.id}/edit`}>
              <Pencil aria-hidden="true" />
              {tc('edit')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>
            <Trash2 aria-hidden="true" />
            {t('manage.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        tone="danger"
        title={t('manage.deleteTitle')}
        description={t('manage.deleteDescription', { count: event.goingCount + event.interestedCount })}
        confirmLabel={t('manage.delete')}
        onConfirm={() =>
          remove.mutateAsync().then(
            () => {
              notify.success(t('manage.deleted'));
              router.replace(`/communities/${event.community.id}?tab=events`);
            },
            (error: unknown) => {
              notify.error(errorMessage(error));
              throw error;
            },
          )
        }
      />
    </>
  );
}

function Participants({ event }: { event: EventDto }) {
  const t = useTranslations('events');
  const query = useEventParticipants(event.id);
  return (
    <section aria-labelledby="participants-heading" className="flex flex-col gap-3">
      <h2 id="participants-heading" className="text-lg font-semibold">
        {t('participants.title')}
      </h2>
      <InfiniteList
        query={query}
        label={t('participants.title')}
        getKey={(p) => p.user.id}
        className="overflow-hidden rounded-2xl border bg-card"
        listClassName="[&>li+li]:border-t"
        skeleton={<ListItemSkeleton />}
        skeletonCount={3}
        hideEnd
        empty={<EmptyState icon={CalendarDays} title={t('participants.emptyTitle')} description={t('participants.emptyDescription')} />}
        renderItem={(p) => (
          <Link href={`/u/${p.user.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-accent focus-ring focus-visible:-outline-offset-2">
            <UserAvatar user={{ ...p.user, name: p.user.name || p.user.nickname }} size="sm" decorative />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{p.user.name || `@${p.user.nickname}`}</span>
              {p.user.nickname ? <span className="truncate text-sm text-muted-foreground">@{p.user.nickname}</span> : null}
            </span>
            <Badge variant={p.status === 'going' ? 'success' : 'primary'} size="sm">
              {p.status === 'going' ? <Check aria-hidden="true" /> : <Star aria-hidden="true" />}
              {p.status === 'going' ? t('rsvp.going') : t('rsvp.interested')}
            </Badge>
          </Link>
        )}
      />
    </section>
  );
}

function EventSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-narrow flex-col gap-5 pt-2">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
