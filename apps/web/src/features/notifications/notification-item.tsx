'use client';

import type { NotificationDto } from '@autoc/shared';
import { Bell, Check, ShieldCheck, Siren, UserCheck, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Avatar } from '@/components/ui/avatar';
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
  | { key: 'types.generic'; values: Record<string, never> };

type TitleContext = {
  someone: string;
  someCommunity: string;
  sosType: (type: Extract<NotificationView, { kind: 'sos_nearby' }>['sosType']) => string;
  distance: (meters: number | null) => string;
};

function titleSpec(view: NotificationView, ctx: TitleContext): TitleSpec {
  const { someone, someCommunity } = ctx;
  switch (view.kind) {
    case 'sos_nearby':
      return { key: 'types.sosNearby', values: { name: displayName(view.user) ?? someone, type: ctx.sosType(view.sosType), distance: ctx.distance(view.distanceM) } };
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
    default:
      return { key: 'types.generic', values: {} };
  }
}

/** Plain-text title for toasts and push-style surfaces. */
function useTitleContext(): TitleContext {
  const t = useTranslations('notifications');
  const ts = useTranslations('sos.types');
  const format = useFormatter();
  return {
    someone: t('someone'),
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
  if (SOS_KINDS.has(view.kind)) {
    // SOS events get the SOS tile: red marks an emergency, never "unread".
    return (
      <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-sos-soft text-sos-soft-foreground">
        <Siren className="size-5" />
      </span>
    );
  }
  if ((view.kind === 'friend_request' || view.kind === 'friend_accepted' || view.kind === 'community_request') && view.user) {
    return <Avatar id={view.user.id} name={view.user.name || view.user.nickname} src={view.user.avatarUrl} size="md" decorative />;
  }
  const Icon =
    view.kind === 'friend_accepted'
      ? UserCheck
      : view.kind === 'community_approved' || view.kind === 'community_request'
        ? UsersRound
        : view.kind === 'community_role'
          ? ShieldCheck
          : Bell;
  return (
    <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
      <Icon className="size-5" />
    </span>
  );
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
