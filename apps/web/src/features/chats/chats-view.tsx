'use client';

import type { ChatDto } from '@autoc/shared';
import { MessageCircle, UsersRound, Siren } from 'lucide-react';
import Link from 'next/link';
import { useNow, useTranslations } from 'next-intl';
import { Avatar } from '@/components/ui/avatar';
import { CountBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { InfiniteList } from '@/components/ui/infinite-list';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/lib/auth/guards';
import { cn } from '@/lib/cn';
import { useChatTime, useMessagePreview } from './format';
import { useChats } from './queries';

/** /chats — direct and community chats, most recent first, kept live by the socket. */
export function ChatsView() {
  const t = useTranslations('chats');
  const query = useChats();
  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-4">
      <PageHeader title={t('title')} description={t('description')} />
      <InfiniteList
        query={query}
        label={t('listLabel')}
        getKey={(chat) => chat.id}
        className="overflow-hidden rounded-2xl border bg-card"
        listClassName="[&>li+li]:border-t"
        skeleton={<ChatRowSkeleton />}
        skeletonCount={6}
        hideEnd
        empty={
          <EmptyState
            icon={MessageCircle}
            title={t('empty.title')}
            description={t('empty.description')}
            action={
              <Button asChild leadingIcon={<UsersRound aria-hidden="true" />}>
                <Link href="/communities">{t('empty.action')}</Link>
              </Button>
            }
          />
        }
        renderItem={(chat) => <ChatRow chat={chat} />}
      />
    </div>
  );
}

export function ChatRow({ chat }: { chat: ChatDto }) {
  const t = useTranslations('chats');
  const me = useCurrentUser();
  const preview = useMessagePreview();
  const time = useChatTime();
  const now = useNow({ updateInterval: 60_000 });
  const last = chat.lastMessage;
  const unread = chat.unreadCount > 0;
  const prefix =
    last && !last.deletedAt && last.type !== 'system'
      ? last.sender.id === me.id
        ? `${t('you')}: `
        : chat.type !== 'direct'
          ? `${last.sender.name || last.sender.nickname}: `
          : ''
      : '';

  return (
    <Link
      href={`/chats/${chat.id}`}
      className="flex min-h-[4.5rem] w-full items-center gap-3 px-4 py-3 text-start transition-colors duration-fast hover:bg-accent focus-ring focus-visible:-outline-offset-2"
      data-testid="chat-row"
      data-unread={chat.unreadCount}
    >
      {chat.type === 'sos' ? (
        <SosChatAvatar size="lg" />
      ) : (
        <Avatar id={chat.peer?.id ?? chat.refId ?? chat.id} name={chat.title} src={chat.avatarUrl ?? chat.peer?.avatarUrl ?? null} shape={chat.type === 'direct' ? 'circle' : 'square'} size="lg" decorative />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-[0.9375rem]', unread ? 'font-semibold text-foreground' : 'font-medium text-foreground')}>
            {chat.title}
          </span>
          {last ? (
            <time dateTime={last.createdAt} className={cn('shrink-0 text-xs tabular-nums', unread ? 'font-semibold text-primary' : 'text-muted-foreground')}>
              {time(last.createdAt, now)}
            </time>
          ) : null}
        </span>
        <span className="flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-sm', last?.deletedAt ? 'italic text-muted-foreground' : unread ? 'text-foreground' : 'text-muted-foreground')}>
            {prefix}
            {preview(last)}
          </span>
          {unread ? (
            <>
              <CountBadge aria-hidden="true" count={chat.unreadCount} className="ring-0" />
              <span className="sr-only">{t('unread', { count: chat.unreadCount })}</span>
            </>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

function ChatRowSkeleton() {
  return (
    <div aria-hidden="true" className="flex min-h-[4.5rem] items-center gap-3 px-4 py-3">
      <Skeleton className="size-14 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3.5 w-3/4" />
      </div>
    </div>
  );
}

/** SOS group chats have no picture: the siren on the SOS tile (API.md §4: `avatarUrl` is null). */
export function SosChatAvatar({ size }: { size: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 items-center justify-center rounded-xl bg-sos-soft text-sos-soft-foreground', size === 'lg' ? 'size-12' : 'size-10')}
    >
      <Siren className={size === 'lg' ? 'size-6' : 'size-5'} />
    </span>
  );
}
