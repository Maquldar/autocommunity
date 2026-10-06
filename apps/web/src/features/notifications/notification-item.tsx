'use client';

import type { NotificationDto } from '@autoc/shared';
import { Bell, CalendarClock, CalendarDays, CalendarX, CarFront, Check, Crown, ShieldAlert, ShieldCheck, Siren, Star, ThumbsDown, UserCheck, UsersRound, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Button } from '@/components/ui/button';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { hasErrorCode } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { useFriendAction } from '@/features/friends/queries';
import { distanceParts } from '@/features/sos/format';
import { describeNotification, displayName, type NotificationView } from './describe';

type TitleSpec =
  | { key: 'types.friendRequest' | 'types.friendAccepted'; values: { name: string } }
  | { key: 'types.communityRequest'; values: { name: string; community: string } }
  | { key: 'types.communityApproved'; values: { community: string } }
  | { key: 'types.communityRole'; values: { community: string; role: string } }
  | { key: 'types.sosNearby'; values: { name: string; type: string; distance: string } }
  | { key: 'types.sosResponse' | 'types.sosAccepted'; values: { name: string } }
  | { key: 'types.sosStatus'; values: { name: string; event: string } }
  | { key: 'types.reviewReceived'; values: { name: string; stars: number } }
  | { key: 'types.moderation'; values: { variant: string; service: string } }
  | { key: 'types.eventNew' | 'types.eventUpdated'; values: { title: string; community: string; when: string } }
  | { key: 'types.eventCancelled'; values: { title: string } }
  | { key: 'types.eventReminder'; values: { title: string; when: string } }
  | { key: 'types.postComment'; values: { name: string; preview: string } }
  | { key: 'types.postLike'; values: { name: string } }
  | { key: 'types.walletReceived'; values: { name: string; amount: number } }
  | { key: 'types.walletAdmin'; values: { action: string; amount: number; sign: string; balance: number } }
  | { key: 'types.premiumReminder'; values: { variant: string; date: string; price: number } }
  | { key: 'types.premiumRenewed'; values: { date: string; price: number } }
  | { key: 'types.premiumExpired'; values: { reason: string } }
  | { key: 'types.voteReceived'; values: { reason: string } }
  | { key: 'types.violationReported'; values: { category: string; vehicle: string } }
  | { key: 'types.violationStatus'; values: { status: string; role: string; category: string } }
  | { key: 'types.generic'; values: Record<string, never> };

type TitleContext = {
  someone: string;
  someCommunity: string;
  sosType: (type: Extract<NotificationView, { kind: 'sos_nearby' }>['sosType']) => string;
  distance: (meters: number | null) => string;
  /** Event times in notifications: Almaty wall-clock time (the app's time zone). */
  when: (iso: string) => string;
  /** A day ("12 Oct 2026") for premium periods. */
  day: (iso: string | null) => string;
  voteReason: (reason: string | null) => string;
  category: (category: string | null) => string;
  someCar: string;
};

function eventWhen(iso: string | null, format: (iso: string) => string): string {
  return iso ? format(iso) : '';
}

function titleSpec(view: NotificationView, ctx: TitleContext): TitleSpec {
  const { someone, someCommunity, when } = ctx;
  switch (view.kind) {
    case 'sos_nearby':
      return { key: 'types.sosNearby', values: { name: displayName(view.user) ?? someone, type: ctx.sosType(view.sosType), distance: ctx.distance(view.distanceM) } };
    case 'review_received':
      return { key: 'types.reviewReceived', values: { name: displayName(view.user) ?? someone, stars: view.stars } };
    case 'sos_response':
      return { key: 'types.sosResponse', values: { name: displayName(view.user) ?? someone } };
    case 'sos_accepted':
      return { key: 'types.sosAccepted', values: { name: displayName(view.user) ?? someone } };
    case 'sos_status':
      return { key: 'types.sosStatus', values: { name: displayName(view.user) ?? someone, event: view.event } };
    case 'friend_request':
      return { key: 'types.friendRequest', values: { name: displayName(view.user) ?? someone } };
    case 'friend_accepted':
      return { key: 'types.friendAccepted', values: { name: displayName(view.user) ?? someone } };
    case 'community_request':
      return { key: 'types.communityRequest', values: { name: displayName(view.user) ?? someone, community: view.communityName || someCommunity } };
    case 'community_approved':
      return { key: 'types.communityApproved', values: { community: view.communityName || someCommunity } };
    case 'community_role':
      return { key: 'types.communityRole', values: { community: view.communityName || someCommunity, role: view.role } };
    case 'moderation':
      return { key: 'types.moderation', values: { variant: view.variant, service: view.serviceName || someCommunity } };
    case 'event_new':
      if (view.change === 'cancelled') return { key: 'types.eventCancelled', values: { title: view.title } };
      return {
        key: view.change === 'updated' ? 'types.eventUpdated' : 'types.eventNew',
        values: { title: view.title, community: view.communityName || someCommunity, when: eventWhen(view.startsAt, when) },
      };
    case 'event_reminder':
      return { key: 'types.eventReminder', values: { title: view.title, when: eventWhen(view.startsAt, when) } };
    case 'post_comment':
      return { key: 'types.postComment', values: { name: displayName(view.user) ?? someone, preview: view.preview } };
    case 'post_like':
      return { key: 'types.postLike', values: { name: displayName(view.user) ?? someone } };
    case 'wallet_received':
      return { key: 'types.walletReceived', values: { name: displayName(view.user) ?? someone, amount: view.amount } };
    case 'wallet_admin':
      return {
        key: 'types.walletAdmin',
        values: { action: view.action, amount: Math.abs(view.amount ?? 0), sign: (view.amount ?? 0) < 0 ? 'minus' : 'plus', balance: view.balance ?? 0 },
      };
    case 'premium_reminder':
      return {
        key: 'types.premiumReminder',
        values: { variant: !view.autoRenew ? 'ends' : view.lowBalance ? 'low' : 'renews', date: ctx.day(view.periodEnd), price: view.price },
      };
    case 'premium_renewed':
      return { key: 'types.premiumRenewed', values: { date: ctx.day(view.periodEnd), price: view.price } };
    case 'premium_expired':
      return { key: 'types.premiumExpired', values: { reason: view.reason } };
    case 'vote_received':
      return { key: 'types.voteReceived', values: { reason: ctx.voteReason(view.reason) } };
    case 'violation_reported':
      return { key: 'types.violationReported', values: { category: ctx.category(view.category), vehicle: view.vehicle || ctx.someCar } };
    case 'violation_status':
      return { key: 'types.violationStatus', values: { status: view.status, role: view.role, category: ctx.category(view.category) } };
    default:
      return { key: 'types.generic', values: {} };
  }
}

function useWhen(): (iso: string) => string {
  const format = useFormatter();
  return (iso) => format.dateTime(new Date(iso), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** Plain-text title for toasts and push-style surfaces. */
function useTitleContext(): TitleContext {
  const t = useTranslations('notifications');
  const ts = useTranslations('sos.types');
  const tv = useTranslations('votes.reasons');
  const tc = useTranslations('violations.categories');
  const format = useFormatter();
  const when = useWhen();
  return {
    someone: t('someone'),
    when,
    day: (iso) => (iso ? format.dateTime(new Date(iso), { dateStyle: 'medium' }) : ''),
    voteReason: (reason) => (reason ? tv(reason as 'other') : t('someReason')),
    category: (category) => (category ? tc(category as 'other') : t('someViolation')),
    someCar: t('someCar'),
    someCommunity: t('someCommunity'),
    sosType: (type) => ts(type),
    distance: (meters) => {
      if (meters === null) return t('distanceUnknown');
      const { value, unit } = distanceParts(meters);
      return format.number(value, { style: 'unit', unit, unitDisplay: 'short' });
    },
  };
}

export function useNotificationTitle(): (notification: Pick<NotificationDto, 'type' | 'payload'>) => string {
  const t = useTranslations('notifications');
  const ctx = useTitleContext();
  return (notification) => {
    const spec = titleSpec(describeNotification(notification), ctx);
    return t.markup(spec.key, { ...spec.values, b: (c) => c });
  };
}

function Title({ view }: { view: NotificationView }) {
  const t = useTranslations('notifications');
  const ctx = useTitleContext();
  const b = (chunks: ReactNode) => <strong className="font-semibold">{chunks}</strong>;
  const spec = titleSpec(view, ctx);
  return <>{t.rich(spec.key, { ...spec.values, b })}</>;
}

const SOS_KINDS = new Set<NotificationView['kind']>(['sos_nearby', 'sos_response', 'sos_accepted', 'sos_status']);

function Leading({ view }: { view: NotificationView }) {
  if (view.kind === 'review_received') {
    return (
      <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-warning-soft text-warning-soft-foreground">
        <Star className="size-5" />
      </span>
    );
  }
  if (SOS_KINDS.has(view.kind)) {
    // SOS events get the SOS tile: red marks an emergency, never "unread".
    return (
      <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-sos-soft text-sos-soft-foreground">
        <Siren className="size-5" />
      </span>
    );
  }
  if (
    (view.kind === 'friend_request' ||
      view.kind === 'friend_accepted' ||
      view.kind === 'community_request' ||
      view.kind === 'post_comment' ||
      view.kind === 'post_like' ||
      view.kind === 'wallet_received') &&
    view.user
  ) {
    return <UserAvatar user={{ ...view.user, name: view.user.name || view.user.nickname }} size="md" decorative />;
  }
  if (view.kind === 'premium_reminder' || view.kind === 'premium_renewed' || view.kind === 'premium_expired') {
    return (
      <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-premium-soft text-premium-soft-foreground">
        <Crown className="size-5" />
      </span>
    );
  }
  if (view.kind === 'vote_received' || view.kind === 'violation_reported' || (view.kind === 'violation_status' && view.status === 'approved' && view.role === 'owner')) {
    return (
      <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-warning-soft text-warning-soft-foreground">
        {view.kind === 'vote_received' ? <ThumbsDown className="size-5" /> : <CarFront className="size-5" />}
      </span>
    );
  }
  const Icon = iconFor(view);
  return (
    <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
      <Icon className="size-5" />
    </span>
  );
}

function iconFor(view: NotificationView): typeof Bell {
  switch (view.kind) {
    case 'wallet_received':
    case 'wallet_admin':
      return Wallet;
    case 'violation_status':
    case 'violation_reported':
      return CarFront;
    case 'friend_accepted':
      return UserCheck;
    case 'community_approved':
    case 'community_request':
      return UsersRound;
    case 'community_role':
      return ShieldCheck;
    case 'moderation':
      return ShieldAlert;
    case 'event_new':
      return view.change === 'cancelled' ? CalendarX : CalendarDays;
    case 'event_reminder':
      return CalendarClock;
    default:
      return Bell;
  }
}

type RequestState = 'idle' | 'accepted' | 'declined' | 'gone';

function FriendRequestActions({
  view,
  onActed,
}: {
  view: Extract<NotificationView, { kind: 'friend_request' }>;
  onActed: () => void;
}) {
  const t = useTranslations();
  const online = useOnlineStatus();
  const mutation = useFriendAction();
  const [state, setState] = useState<RequestState>('idle');

  if (!view.user || !view.requestId) return null;
  if (state !== 'idle') {
    const text = state === 'accepted' ? t('notifications.accepted') : state === 'declined' ? t('notifications.declined') : t('notifications.gone');
    return (
      <p role="status" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        {state === 'accepted' ? <Check aria-hidden="true" className="size-4 text-success" /> : null}
        {text}
      </p>
    );
  }

  const user = { id: view.user.id, name: displayName(view.user) ?? '', relation: 'request_in' as const };
  const act = (action: 'accept' | 'decline') => {
    onActed();
    mutation.mutate(
      { user, action, requestId: view.requestId! },
      {
        onSuccess: () => setState(action === 'accept' ? 'accepted' : 'declined'),
        onError: (error) => {
          if (hasErrorCode(error, 'NOT_FOUND')) setState('gone');
        },
      },
    );
  };
  const pending = mutation.isPending ? mutation.variables?.action : undefined;

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" loading={pending === 'accept'} disabled={!online || mutation.isPending} onClick={() => act('accept')}>
        {t('friends.actions.accept')}
      </Button>
      <Button size="sm" variant="secondary" loading={pending === 'decline'} disabled={!online || mutation.isPending} onClick={() => act('decline')}>
        {t('friends.actions.decline')}
      </Button>
    </div>
  );
}

/**
 * One notification row. Unread rows have a tinted background, a dot and bold text (never colour alone)
 * plus an sr-only "Unread". Opening the row marks it read. Friend requests get inline Accept/Decline,
 * outside the link so controls never nest.
 */
export function NotificationItem({ notification, onRead }: { notification: NotificationDto; onRead: (n: NotificationDto) => void }) {
  const t = useTranslations('notifications');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const view = describeNotification(notification);
  const unread = notification.readAt === null;
  const markRead = () => {
    if (unread) onRead(notification);
  };

  const body = (
    <>
      <span className="relative flex shrink-0">
        <Leading view={view} />
        {unread ? (
          <span aria-hidden="true" className="absolute -start-1 -top-0.5 size-3 rounded-full border-2 border-card bg-primary" />
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('break-words text-[0.9375rem] leading-snug', unread ? 'text-foreground' : 'text-muted-foreground')}>
          {unread ? <span className="sr-only">{t('unread')}: </span> : null}
          <Title view={view} />
        </span>
        {(view.kind === 'wallet_admin' && view.note) || (view.kind === 'wallet_received' && view.message) ? (
          <span className="break-words text-sm text-foreground" data-testid="notification-note">
            «{view.kind === 'wallet_admin' ? view.note : view.kind === 'wallet_received' ? view.message : ''}»
          </span>
        ) : null}
        {view.kind === 'moderation' && (view.note || view.until) ? (
          <span className="break-words text-sm text-foreground" data-testid="notification-note">
            {view.note}
            {view.note && view.until ? ' · ' : null}
            {view.until ? t('until', { date: format.dateTime(new Date(view.until), { dateStyle: 'medium', timeStyle: 'short' }) }) : null}
          </span>
        ) : null}
        <time dateTime={notification.createdAt} className="text-sm text-muted-foreground">
          {format.relativeTime(new Date(notification.createdAt), now)}
        </time>
      </span>
    </>
  );

  const rowClass = 'flex w-full items-start gap-3 px-4 py-3 text-start';
  return (
    <div data-unread={unread || undefined} className={cn('transition-colors duration-fast', unread && 'bg-primary-soft/50')}>
      {view.href ? (
        <Link href={view.href} onClick={markRead} className={cn(rowClass, 'hover:bg-accent focus-ring focus-visible:-outline-offset-2')}>
          {body}
        </Link>
      ) : unread ? (
        <button type="button" onClick={markRead} className={cn(rowClass, 'hover:bg-accent focus-ring focus-visible:-outline-offset-2')}>
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
      {view.kind === 'friend_request' ? (
        <div className="-mt-1 pb-3 ps-[4.25rem] pe-4">
          <FriendRequestActions view={view} onActed={markRead} />
        </div>
      ) : null}
    </div>
  );
}
