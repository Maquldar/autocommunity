'use client';

import type { NotificationDto } from '@autoc/shared';
import { Bell, Check, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { hasErrorCode } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { useFriendAction } from '@/features/friends/queries';
import { describeNotification, displayName, type NotificationView } from './describe';

/** Plain-text title for toasts and push-style surfaces. */
export function useNotificationTitle(): (notification: Pick<NotificationDto, 'type' | 'payload'>) => string {
  const t = useTranslations('notifications');
  return (notification) => {
    const view = describeNotification(notification);
    const name = displayName(view.kind === 'generic' ? null : view.user) ?? t('someone');
    if (view.kind === 'friend_request') return t.markup('types.friendRequest', { name, b: (c) => c });
    if (view.kind === 'friend_accepted') return t.markup('types.friendAccepted', { name, b: (c) => c });
    return t('types.generic');
  };
}

function Title({ view }: { view: NotificationView }) {
  const t = useTranslations('notifications');
  const b = (chunks: ReactNode) => <strong className="font-semibold">{chunks}</strong>;
  if (view.kind === 'generic') return <>{t('types.generic')}</>;
  const name = displayName(view.user) ?? t('someone');
  return <>{t.rich(view.kind === 'friend_request' ? 'types.friendRequest' : 'types.friendAccepted', { name, b })}</>;
}

function Leading({ view }: { view: NotificationView }) {
  if (view.kind !== 'generic' && view.user) {
    return <Avatar id={view.user.id} name={view.user.name || view.user.nickname} src={view.user.avatarUrl} size="md" decorative />;
  }
  return (
    <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
      {view.kind === 'friend_accepted' ? <UserCheck className="size-5" /> : <Bell className="size-5" />}
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
