'use client';

import { CHAT_LIMITS, type ChatDto, type Me, type UserMini } from '@autoc/shared';
import { ArrowDown, ArrowLeft, MessageCircleOff, MessagesSquare } from 'lucide-react';
import Link from 'next/link';
import { useNow, useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { hasErrorCode } from '@/lib/api/errors';
import { useCurrentUser } from '@/lib/auth/guards';
import { useRealtimeConnected, useRealtimeSocket } from '@/lib/realtime/realtime-provider';
import { notify } from '@/lib/toast';
import { communityPermissions } from '@/features/communities/membership-state';
import { useCommunity } from '@/features/communities/queries';
import { flattenMessages, setActiveChat } from './cache';
import { Composer } from './composer';
import { SosChatAvatar } from './chats-view';
import { useDayLabel } from './format';
import { createThrottle, readStore, typingStore } from './live-stores';
import { MessageBubble } from './message-bubble';
import { usePendingMessages, useSendMessage } from './outbox';
import { useChat, useChatMessages, useDeleteMessage, useMarkChatRead } from './queries';
import { buildTimeline, groupPosition, type TimelineItem } from './timeline';

function toMini(me: Me): UserMini {
  return {
    id: me.id,
    nickname: me.nickname ?? '',
    name: me.name,
    avatarUrl: me.avatarUrl,
    rating: me.rating,
  };
}

function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener('visibilitychange', onChange);
      return () => document.removeEventListener('visibilitychange', onChange);
    },
    () => document.visibilityState === 'visible',
    () => true,
  );
}

/** /chats/[id] — full-height conversation: header, history (upward infinite scroll), typing line, composer. */
export function ConversationView({ chatId }: { chatId: string }) {
  const t = useTranslations('chats.conversation');
  const errorMessage = useErrorMessage();
  const chat = useChat(chatId);

  let body;
  if (chat.isPending) {
    body = <ConversationSkeleton label={t('loading')} />;
  } else if (chat.isError) {
    body =
      hasErrorCode(chat.error, 'NOT_FOUND') || hasErrorCode(chat.error, 'VALIDATION_ERROR') ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState
            icon={MessageCircleOff}
            title={t('notFound.title')}
            description={t('notFound.description')}
            action={
              <Button asChild>
                <Link href="/chats">{t('notFound.back')}</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <ErrorState description={errorMessage(chat.error)} onRetry={() => void chat.refetch()} retrying={chat.isFetching} />
        </div>
      );
  } else {
    body = <Conversation chat={chat.data} />;
  }

  return (
    // Fills <main> (full-bleed route); the phone tab bar is hidden here, so it reaches the bottom edge.
    <div className="absolute inset-0 flex flex-col overflow-hidden" data-testid="conversation">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-content flex-col lg:border-x">{body}</div>
    </div>
  );
}

function Conversation({ chat }: { chat: ChatDto }) {
  const t = useTranslations('chats');
  const meFull = useCurrentUser();
  const me = useMemo(() => toMini(meFull), [meFull]);
  const online = useOnlineStatus();
  const visible = useDocumentVisible();
  const socket = useRealtimeSocket();
  const connected = useRealtimeConnected();
  const errorMessage = useErrorMessage();

  const isCommunity = chat.type === 'community' && chat.refId !== null;
  // Moderators may delete anyone's messages in their community chat.
  const community = useCommunity(chat.refId ?? '', isCommunity);
  const isModerator = isCommunity && community.data ? communityPermissions(community.data).isModerator : false;

  const messages = useChatMessages(chat.id);
  const pending = usePendingMessages(chat.id);
  const { send, retry, discard } = useSendMessage(chat.id, me);
  const removeMessage = useDeleteMessage(chat.id);
  const markRead = useMarkChatRead(chat.id);
  const [deleting, setDeleting] = useState<string | null>(null);

  const server = useMemo(() => flattenMessages(messages.data), [messages.data]);
  const timeline = useMemo(() => buildTimeline(server, pending, me), [server, pending, me]);

  const peerRead = useSyncExternalStore(
    readStore.subscribe,
    () => readStore.latestPeerRead(chat.id, me.id),
    () => 0,
  );
  const typing = useSyncExternalStore(
    typingStore.subscribe,
    () => typingStore.get(chat.id),
    () => typingStore.get(chat.id),
  );

  // While open and visible, incoming messages are read (no unread bump, see cache.applyIncomingMessage).
  useEffect(() => {
    if (!visible) return undefined;
    setActiveChat(chat.id);
    return () => setActiveChat(null);
  }, [chat.id, visible]);

  // Chats created after the socket connected need an explicit join to get live events.
  useEffect(() => {
    if (socket && connected) socket.emit('chat:join', { chatId: chat.id });
  }, [socket, connected, chat.id]);

  // Read receipt: whenever a newer message from someone else is on screen.
  const lastIncoming = useMemo(() => {
    for (let i = server.length - 1; i >= 0; i -= 1) if (server[i]!.sender.id !== me.id) return server[i]!.id;
    return null;
  }, [server, me.id]);
  const readSent = useRef<string | null>(null);
  const markReadMutate = markRead.mutate;
  useEffect(() => {
    if (!visible || !messages.isSuccess) return;
    const key = lastIncoming ?? 'none';
    if (readSent.current === key) return;
    if (lastIncoming === null && chat.unreadCount === 0) return;
    readSent.current = key;
    markReadMutate();
  }, [visible, messages.isSuccess, lastIncoming, chat.unreadCount, markReadMutate]);

  const throttle = useMemo(() => createThrottle(CHAT_LIMITS.typingThrottleMs), []);
  const onTyping = useCallback(() => {
    if (socket?.connected && throttle()) socket.emit('chat:typing', { chatId: chat.id });
  }, [socket, throttle, chat.id]);

  const onDelete = useCallback((messageId: string) => setDeleting(messageId), []);

  return (
    <>
      <ConversationHeader chat={chat} typing={typing.length > 0 && chat.type === 'direct'} />

      <MessageList
        chat={chat}
        timeline={timeline}
        me={me}
        query={messages}
        isCommunity={chat.type !== 'direct'}
        peerRead={peerRead}
        canModerate={isModerator}
        onDelete={onDelete}
        onRetry={retry}
        onDiscard={discard}
      />

      <div className="shrink-0 border-t bg-background/95 pb-safe backdrop-blur-md">
        {chat.type !== 'direct' ? <TypingLine users={typing} /> : null}
        <Composer disabled={!online} onSend={send} onTyping={onTyping} />
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        tone="danger"
        title={t('deleteConfirm.title')}
        description={t('deleteConfirm.description')}
        confirmLabel={t('deleteConfirm.confirm')}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await removeMessage.mutateAsync(deleting);
          } catch (error) {
            notify.error(errorMessage(error));
            throw error;
          }
        }}
      />
    </>
  );
}

function ConversationHeader({ chat, typing }: { chat: ChatDto; typing: boolean }) {
  const t = useTranslations('chats');
  const tc = useTranslations('common');
  const href =
    chat.type === 'direct' && chat.peer
      ? `/u/${chat.peer.id}`
      : chat.type === 'community' && chat.refId
        ? `/communities/${chat.refId}`
        : chat.type === 'sos' && chat.refId
          ? `/sos/${chat.refId}`
          : null;
  const subtitle = typing
    ? t('typing.direct')
    : chat.type === 'direct' && chat.peer?.nickname
      ? `@${chat.peer.nickname}`
      : chat.type === 'community'
        ? t('conversation.communityChat')
        : chat.type === 'sos'
          ? t('conversation.sosChat')
          : null;
  const identity = (
    <>
      {chat.type === 'sos' ? (
        <SosChatAvatar size="md" />
      ) : (
        <Avatar
          id={chat.peer?.id ?? chat.refId ?? chat.id}
          name={chat.title}
          src={chat.avatarUrl ?? chat.peer?.avatarUrl ?? null}
          shape={chat.type === 'direct' ? 'circle' : 'square'}
          size="md"
          decorative
        />
      )}
      <span className="flex min-w-0 flex-col">
        <h1 className="truncate text-base font-semibold leading-6">{chat.title}</h1>
        {subtitle ? (
          <span className={typing ? 'truncate text-sm text-primary' : 'truncate text-sm text-muted-foreground'}>{subtitle}</span>
        ) : null}
      </span>
    </>
  );
  return (
    <header className="flex shrink-0 items-center gap-2 border-b bg-background px-2 py-2 sm:px-3">
      <IconButton asChild aria-label={tc('back')}>
        <Link href={chat.type === 'sos' && chat.refId ? `/sos/${chat.refId}` : '/chats'}>
          <ArrowLeft className="rtl:rotate-180" />
        </Link>
      </IconButton>
      {href ? (
        <Link
          href={href}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 hover:bg-accent focus-ring"
          aria-label={`${chat.title}. ${chat.type === 'direct' ? t('conversation.openProfile') : chat.type === 'sos' ? t('conversation.openSos') : t('conversation.openCommunity')}`}
        >
          {identity}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 p-1">{identity}</div>
      )}
    </header>
  );
}

function TypingLine({ users }: { users: UserMini[] }) {
  const t = useTranslations('chats.typing');
  const names = users.map((u) => u.name || u.nickname);
  const text =
    names.length === 0
      ? ''
      : names.length === 1
        ? t('one', { name: names[0]! })
        : names.length === 2
          ? t('two', { a: names[0]!, b: names[1]! })
          : t('many');
  return (
    <p
      aria-live="polite"
      className="min-h-0 truncate px-4 pt-1.5 text-sm text-muted-foreground empty:hidden"
      data-testid="typing-indicator"
    >
      {text ? (
        <>
          <span aria-hidden="true" className="me-1.5 inline-flex gap-0.5 align-middle">
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
          </span>
          {text}
        </>
      ) : null}
    </p>
  );
}

type MessagesQuery = ReturnType<typeof useChatMessages>;

/**
 * History, oldest at the top. Scrolling near the top loads older pages and keeps the reading position;
 * new messages keep the view pinned to the bottom when it already was (or when they are ours).
 */
function MessageList({
  chat,
  timeline,
  me,
  query,
  isCommunity,
  peerRead,
  canModerate,
  onDelete,
  onRetry,
  onDiscard,
}: {
  chat: ChatDto;
  timeline: TimelineItem[];
  me: UserMini;
  query: MessagesQuery;
  isCommunity: boolean;
  peerRead: number;
  canModerate: boolean;
  onDelete: (messageId: string) => void;
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
}) {
  const t = useTranslations('chats');
  const dayLabel = useDayLabel();
  const now = useNow({ updateInterval: 60_000 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLOListElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const snapshot = useRef<{
    first: string | null;
    last: string | null;
    height: number;
  }>({ first: null, last: null, height: 0 });
  const [showJump, setShowJump] = useState(false);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;

  const messagesOnly = timeline.filter((item) => item.kind === 'message');
  const firstKey = messagesOnly[0]?.key ?? null;
  const lastItem = messagesOnly[messagesOnly.length - 1];
  const lastKey = lastItem?.key ?? null;
  const lastIsMine = lastItem?.kind === 'message' && lastItem.message.sender.id === me.id;

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = distance < 96;
    setShowJump(distance > 320);
    snapshot.current.height = el.scrollHeight;
  }, []);

  // Runs before paint: anchor the view when older messages were prepended, follow new ones at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = snapshot.current;
    if (prev.first === null && firstKey !== null) {
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
    } else if (firstKey !== prev.first && lastKey === prev.last) {
      el.scrollTop += el.scrollHeight - prev.height;
    } else if (lastKey !== prev.last && (atBottom.current || lastIsMine)) {
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
    }
    snapshot.current = {
      first: firstKey,
      last: lastKey,
      height: el.scrollHeight,
    };
  }, [firstKey, lastKey, lastIsMine, timeline]);

  // Images and fonts change heights after render: stay pinned to the bottom if we were there.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
      snapshot.current.height = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [query.isSuccess]);

  // Upward infinite scroll.
  const canLoadOlder = hasNextPage && !isFetchingNextPage && !isFetchNextPageError;
  useEffect(() => {
    const root = scrollRef.current;
    const node = topRef.current;
    if (!root || !node || !canLoadOlder || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage();
      },
      { root, rootMargin: '400px 0px 0px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canLoadOlder, fetchNextPage]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  if (query.isPending) return <MessagesSkeleton label={t('conversation.loading')} />;
  if (query.isError) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <ErrorState onRetry={() => void query.refetch()} retrying={query.isFetching} />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
        data-testid="message-scroll"
      >
        {/* Short histories sit at the bottom, next to the composer, like any messenger. */}
        <div className="flex min-h-full flex-col justify-end">
          <div ref={topRef} aria-hidden="true" className="h-px" />
          <div className="flex justify-center py-2">
            {isFetchingNextPage ? (
              <Spinner label={t('conversation.loadingOlder')} />
            ) : isFetchNextPageError ? (
              <ErrorState compact onRetry={() => void fetchNextPage()} />
            ) : hasNextPage ? (
              <Button variant="ghost" size="sm" onClick={() => void fetchNextPage()}>
                {t('conversation.loadOlder')}
              </Button>
            ) : timeline.length > 0 ? (
              <p className="text-sm text-muted-foreground">{t('conversation.start')}</p>
            ) : null}
          </div>

          {timeline.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-4">
              <EmptyState
                icon={MessagesSquare}
                title={t('conversation.empty.title')}
                description={t('conversation.empty.description')}
              />
            </div>
          ) : (
            <ol
              ref={contentRef}
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-label={t('conversation.historyLabel', { title: chat.title })}
              className="flex flex-col px-3 pb-2 sm:px-4"
            >
              {timeline.map((item, index) => {
                if (item.kind === 'day') {
                  return (
                    <li key={item.key} className="sticky top-1 z-raised flex justify-center py-2" data-testid="day-separator">
                      <span className="rounded-full border bg-background/95 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm">
                        {dayLabel(item.date, now)}
                      </span>
                    </li>
                  );
                }
                const mine = item.message.sender.id === me.id;
                const { first, last } = groupPosition(timeline, index);
                const deletable =
                  item.status === 'sent' && !item.message.deletedAt && (mine || (canModerate && chat.type === 'community'));
                return (
                  <li key={item.key}>
                    <MessageBubble
                      item={item}
                      mine={mine}
                      showSender={isCommunity && first}
                      showAvatar={isCommunity && last}
                      avatarColumn={isCommunity && !mine}
                      groupEnd={last}
                      read={mine && peerRead >= Date.parse(item.message.createdAt)}
                      canDelete={deletable}
                      onDelete={onDelete}
                      onRetry={onRetry}
                      onDiscard={onDiscard}
                    />
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      {showJump ? (
        <IconButton
          aria-label={t('conversation.scrollToLatest')}
          variant="outline"
          className="absolute bottom-3 end-3 z-raised bg-card shadow-md"
          onClick={scrollToBottom}
        >
          <ArrowDown />
        </IconButton>
      ) : null}
    </div>
  );
}

function MessagesSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="flex min-h-0 flex-1 flex-col justify-end gap-3 p-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-10 w-3/5 rounded-2xl" />
      <Skeleton className="ms-auto h-10 w-1/2 rounded-2xl" />
      <Skeleton className="h-16 w-2/3 rounded-2xl" />
      <Skeleton className="ms-auto h-10 w-2/5 rounded-2xl" />
    </div>
  );
}

function ConversationSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="flex min-h-0 flex-1 flex-col">
      <span className="sr-only">{label}</span>
      <div className="flex items-center gap-3 border-b px-3 py-2">
        <Skeleton className="size-11 rounded-full" />
        <Skeleton className="size-10 rounded-full" />
        <Skeleton className="h-5 w-40" />
      </div>
      <MessagesSkeleton label={label} />
      <div className="border-t px-3 py-2">
        <Skeleton className="h-11 w-full rounded-full" />
      </div>
    </div>
  );
}
