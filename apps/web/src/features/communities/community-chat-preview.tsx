'use client';

import type { CommunityDto } from '@autoc/shared';
import { MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useNow, useTranslations } from 'next-intl';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { flattenMessages } from '@/features/chats/cache';
import { useChatTime, useMessagePreview } from '@/features/chats/format';
import { useChatMessages } from '@/features/chats/queries';

const PREVIEW_COUNT = 4;

/** Chat tab on a community page: the latest few messages (live) and a button into the full conversation. */
export function CommunityChatPreview({ community }: { community: CommunityDto }) {
  const t = useTranslations('communities.chat');
  const chatId = community.chatId;
  const messages = useChatMessages(chatId ?? '', Boolean(chatId));
  const preview = useMessagePreview();
  const time = useChatTime();
  const now = useNow({ updateInterval: 60_000 });

  if (!chatId) {
    return (
      <div aria-busy="true" className="rounded-2xl border bg-card p-4">
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const latest = flattenMessages(messages.data).slice(-PREVIEW_COUNT);
  return (
    <section aria-labelledby="community-chat-heading" className="flex flex-col gap-3 rounded-2xl border bg-card p-4" data-testid="community-chat">
      <div className="flex items-center justify-between gap-3">
        <h2 id="community-chat-heading" className="text-base font-semibold">
          {t('title')}
        </h2>
      </div>
      {messages.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
      ) : messages.isError ? (
        <ErrorState compact onRetry={() => void messages.refetch()} retrying={messages.isFetching} />
      ) : latest.length === 0 ? (
        <p className="py-2 text-[0.9375rem] text-muted-foreground">{t('empty')}</p>
      ) : (
        <ol aria-label={t('recent')} className="flex flex-col gap-3">
          {latest.map((message) => (
            <li key={message.id} className="flex items-start gap-2.5">
              <UserAvatar user={{ ...message.sender, name: message.sender.name || message.sender.nickname }} size="sm" decorative />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{message.sender.name || `@${message.sender.nickname}`}</span>
                  <time dateTime={message.createdAt} className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {time(message.createdAt, now)}
                  </time>
                </div>
                <p className={message.deletedAt ? 'truncate text-sm italic text-muted-foreground' : 'line-clamp-2 break-words text-sm text-muted-foreground'}>
                  {preview(message)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Button asChild fullWidth leadingIcon={<MessageCircle aria-hidden="true" />}>
        <Link href={`/chats/${chatId}`}>{t('open')}</Link>
      </Button>
    </section>
  );
}
