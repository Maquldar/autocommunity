'use client';

import { AlertCircle, Ban, Check, CheckCheck, Clock, MoreHorizontal, RotateCw, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { memo } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/cn';
import { LocationContent, PhotoContent, VoiceContent } from './message-content';
import type { TimelineMessage } from './timeline';

export type MessageBubbleProps = {
  item: TimelineMessage;
  mine: boolean;
  /** Community chats: name above the first message of a group, avatar beside the last. */
  showSender: boolean;
  showAvatar: boolean;
  /** Reserve the avatar column (community chats, others' messages). */
  avatarColumn: boolean;
  /** Last in a run from the same sender: tail corner + extra spacing after. */
  groupEnd: boolean;
  read: boolean;
  canDelete: boolean;
  onDelete: (messageId: string) => void;
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
};

/**
 * One chat message. Own messages sit on the right in the primary colour, others on the left on a card
 * surface. Time and delivery state (sending · sent · read · failed — icon + sr-only word) sit in the
 * bubble's corner. Deleted messages keep their place as a "Message deleted" placeholder.
 */
export const MessageBubble = memo(function MessageBubble({
  item,
  mine,
  showSender,
  showAvatar,
  avatarColumn,
  groupEnd,
  read,
  canDelete,
  onDelete,
  onRetry,
  onDiscard,
}: MessageBubbleProps) {
  const t = useTranslations('chats');
  const format = useFormatter();
  const { message, status } = item;
  const deleted = message.deletedAt !== null;
  const senderName = message.sender.name || `@${message.sender.nickname}`;
  const time = format.dateTime(new Date(message.createdAt), { hour: '2-digit', minute: '2-digit' });
  const media = !deleted && (message.type === 'photo' || message.type === 'location' || message.type === 'voice');

  const statusIcon = !mine ? null : status === 'sending' ? (
    <Clock aria-hidden="true" className="size-3.5" />
  ) : status === 'failed' ? (
    <AlertCircle aria-hidden="true" className="size-3.5" />
  ) : read ? (
    <CheckCheck aria-hidden="true" className="size-3.5" />
  ) : (
    <Check aria-hidden="true" className="size-3.5" />
  );
  const statusText = !mine ? null : status === 'sending' ? t('status.sending') : status === 'failed' ? t('status.failed') : read ? t('status.read') : t('status.sent');

  return (
    <div
      className={cn('group/message flex w-full items-end gap-2', mine ? 'justify-end' : 'justify-start', groupEnd ? 'pb-2' : 'pb-0.5')}
      data-testid="message"
      data-message-id={status === 'sent' ? message.id : undefined}
      data-status={status}
      data-type={message.type}
      data-deleted={deleted || undefined}
      data-mine={mine || undefined}
    >
      {avatarColumn ? (
        <span className="w-8 shrink-0 self-end">
          {showAvatar ? (
            <Link href={`/u/${message.sender.id}`} tabIndex={-1} aria-hidden="true">
              <Avatar id={message.sender.id} name={senderName} src={message.sender.avatarUrl} size="sm" decorative />
            </Link>
          ) : null}
        </span>
      ) : null}

      {mine && canDelete ? <MessageActions onDelete={() => onDelete(message.id)} /> : null}

      <div className={cn('flex min-w-0 max-w-[min(85%,30rem)] flex-col', mine ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'relative flex min-w-0 max-w-full flex-col gap-1 rounded-2xl text-[0.9375rem] leading-snug',
            media ? 'p-1.5' : 'px-3 py-2',
            deleted
              ? 'border border-dashed bg-transparent text-muted-foreground'
              : mine
                ? 'bg-primary text-primary-foreground'
                : 'border bg-card text-card-foreground',
            status === 'failed' && 'opacity-80',
            groupEnd && (mine ? 'rounded-ee-md' : 'rounded-es-md'),
          )}
        >
          {showSender && !mine ? (
            <Link href={`/u/${message.sender.id}`} className={cn('truncate text-sm font-semibold text-primary hover:underline focus-ring rounded-sm', media && 'px-1.5 pt-0.5')}>
              {senderName}
            </Link>
          ) : null}

          {deleted ? (
            <p className="inline-flex items-center gap-1.5 italic">
              <Ban aria-hidden="true" className="size-4 shrink-0" />
              {t('message.deleted')}
            </p>
          ) : message.type === 'photo' ? (
            <>
              <PhotoContent message={message} mine={mine} />
              {message.text ? <p className="whitespace-pre-wrap break-words px-1.5 pb-0.5 [overflow-wrap:anywhere]">{message.text}</p> : null}
            </>
          ) : message.type === 'location' ? (
            <LocationContent message={message} />
          ) : message.type === 'voice' ? (
            <div className="px-1.5 pt-1">
              <VoiceContent message={message} mine={mine} />
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.text}</p>
          )}

          <span className={cn('flex items-center justify-end gap-1 self-end text-xs tabular-nums', media && 'px-1.5 pb-0.5', !mine && 'text-muted-foreground')}>
            <time dateTime={message.createdAt}>{time}</time>
            {statusIcon}
            {statusText ? <span className="sr-only">{statusText}</span> : null}
          </span>
        </div>

        {status === 'failed' && item.pending ? (
          <div className="mt-1 flex flex-wrap items-center justify-end gap-1 text-sm" role="alert">
            <span className="inline-flex items-center gap-1 text-danger">
              <AlertCircle aria-hidden="true" className="size-4" />
              {t('status.failed')}
            </span>
            <Button size="sm" variant="ghost" leadingIcon={<RotateCw aria-hidden="true" />} onClick={() => onRetry(item.pending!.clientId)}>
              {t('message.retry')}
            </Button>
            <Button size="sm" variant="ghost" leadingIcon={<X aria-hidden="true" />} onClick={() => onDiscard(item.pending!.clientId)}>
              {t('message.discard')}
            </Button>
          </div>
        ) : null}
      </div>

      {!mine && canDelete ? <MessageActions onDelete={() => onDelete(message.id)} /> : null}
    </div>
  );
});

/**
 * ⋯ menu beside a bubble. Always in the tab order and visible on touch screens; on hover-capable
 * screens it fades in on hover or keyboard focus.
 */
function MessageActions({ onDelete }: { onDelete: () => void }) {
  const t = useTranslations('chats.message');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label={t('actions')}
          size="sm"
          variant="ghost"
          className="shrink-0 self-center text-muted-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <DropdownMenuItem destructive onSelect={onDelete}>
          <Trash2 aria-hidden="true" />
          {t('delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
