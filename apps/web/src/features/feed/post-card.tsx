'use client';

import type { PostDto } from '@autoc/shared';
import { Flag, Heart, MessageCircle, MoreHorizontal, Trash2, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useState } from 'react';
import { PremiumBadge, UserAvatar } from '@/components/ui/user-avatar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { useDeletePost, useToggleLike } from './api';
import { useFeedErrorMessage } from './errors';
import { MediaGrid } from './media-grid';
import { PollView } from './poll-view';
import { ReportDialog } from './report-dialog';
import { RichText } from './rich-text';

/**
 * A post: author + community badge + time (link to the thread), text with links, media, poll, and a footer
 * with an optimistic like toggle and the comment count. ⋯ menu: report (others' posts), delete (rights).
 */
export function PostCard({ post, onDeleted, inThread = false }: { post: PostDto; onDeleted?: () => void; inThread?: boolean }) {
  const t = useTranslations('feed');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const online = useOnlineStatus();
  const errorMessage = useFeedErrorMessage();
  const like = useToggleLike(post.id);
  const remove = useDeletePost(post.id);
  const [confirm, setConfirm] = useState(false);
  const [reporting, setReporting] = useState(false);
  const authorName = post.author.name || `@${post.author.nickname}`;
  const headingId = `post-${post.id}-author`;

  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm" data-testid="post-card" data-post-id={post.id}>
      <header className="flex items-start gap-3">
        <Link href={`/u/${post.author.id}`} className="shrink-0 rounded-full focus-ring" tabIndex={-1} aria-hidden="true">
          <UserAvatar user={{ ...post.author, name: authorName }} size="md" decorative />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1">
            <Link id={headingId} href={`/u/${post.author.id}`} className="truncate font-semibold underline-offset-4 hover:underline focus-ring rounded-sm">
              {authorName}
            </Link>
            {post.author.isPremium ? <PremiumBadge compact /> : null}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            {post.author.nickname ? <span className="truncate">@{post.author.nickname}</span> : null}
            <span aria-hidden="true">·</span>
            <Link href={`/posts/${post.id}`} className="hover:underline focus-ring rounded-sm">
              <time dateTime={post.createdAt}>{format.relativeTime(new Date(post.createdAt), now)}</time>
            </Link>
          </span>
          {post.community ? (
            <Link
              href={`/communities/${post.community.id}?tab=feed`}
              className="mt-1 inline-flex max-w-full items-center gap-1 self-start rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary-soft-foreground focus-ring"
              data-testid="post-community"
            >
              <UsersRound aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{post.community.name}</span>
            </Link>
          ) : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label={t('post.menu')} variant="ghost" size="sm" data-testid="post-menu">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setReporting(true)}>
              <Flag aria-hidden="true" />
              {t('post.report')}
            </DropdownMenuItem>
            {post.canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>
                  <Trash2 aria-hidden="true" />
                  {t('post.delete')}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {post.text ? <RichText text={post.text} className={inThread ? undefined : 'line-clamp-[12]'} /> : null}
      <MediaGrid media={post.media} label={t('media.label', { name: authorName })} />
      {post.poll ? <PollView postId={post.id} poll={post.poll} /> : null}

      <footer className="-mb-1 -ms-2 flex items-center gap-1">
        <button
          type="button"
          aria-pressed={post.likedByMe}
          aria-label={t('post.likeLabel', { count: post.likeCount })}
          disabled={!online}
          onClick={() => like.mutate(!post.likedByMe, { onError: (e) => notify.error(errorMessage(e)) })}
          className={cn(
            'inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium hover:bg-accent focus-ring disabled:opacity-60',
            post.likedByMe ? 'text-primary' : 'text-muted-foreground',
          )}
          data-testid="like-button"
        >
          <Heart aria-hidden="true" className={cn('size-5', post.likedByMe && 'fill-current')} />
          <span className="tabular-nums" aria-hidden="true">
            {post.likeCount}
          </span>
        </button>
        {inThread ? (
          <span className="inline-flex min-h-11 items-center gap-1.5 px-3 text-sm font-medium text-muted-foreground" data-testid="comment-count">
            <MessageCircle aria-hidden="true" className="size-5" />
            {t('post.comments', { count: post.commentCount })}
          </span>
        ) : (
          <Link
            href={`/posts/${post.id}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-accent focus-ring"
            data-testid="comment-count"
          >
            <MessageCircle aria-hidden="true" className="size-5" />
            {t('post.comments', { count: post.commentCount })}
          </Link>
        )}
      </footer>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        tone="danger"
        title={t('post.deleteTitle')}
        description={t('post.deleteDescription')}
        confirmLabel={t('post.delete')}
        onConfirm={() =>
          remove.mutateAsync().then(
            () => {
              notify.success(t('post.deleted'));
              onDeleted?.();
            },
            (e: unknown) => {
              notify.error(errorMessage(e));
              throw e;
            },
          )
        }
      />
      <ReportDialog open={reporting} onOpenChange={setReporting} targetType="post" targetId={post.id} />
    </article>
  );
}

export function PostCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}
