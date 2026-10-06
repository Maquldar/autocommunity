'use client';

import { FEED_LIMITS, type PostCommentDto } from '@autoc/shared';
import { Flag, MessageCircle, MoreHorizontal, SearchX, Send, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import { PremiumBadge, UserAvatar } from '@/components/ui/user-avatar';
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
import { FormError } from '@/components/ui/form-error';
import { IconButton } from '@/components/ui/icon-button';
import { InfiniteList } from '@/components/ui/infinite-list';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { ListItemSkeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { hasErrorCode } from '@/lib/api/errors';
import { notify } from '@/lib/toast';
import { useAddComment, useComments, useDeleteComment, usePost } from './api';
import { useFeedErrorMessage } from './errors';
import { PostCard, PostCardSkeleton } from './post-card';
import { ReportDialog } from './report-dialog';
import { RichText } from './rich-text';

/** /posts/[id] — the post and its comments (oldest first) with a composer. */
export function PostThreadView({ id }: { id: string }) {
  const t = useTranslations('feed');
  const router = useRouter();
  const errorMessage = useFeedErrorMessage();
  const query = usePost(id);

  let body;
  if (query.isPending) body = <PostCardSkeleton />;
  else if (query.isError) {
    body =
      hasErrorCode(query.error, 'NOT_FOUND') || hasErrorCode(query.error, 'VALIDATION_ERROR') ? (
        <EmptyState
          icon={SearchX}
          title={t('thread.notFoundTitle')}
          description={t('thread.notFoundDescription')}
          action={
            <Button asChild>
              <Link href="/feed">{t('thread.back')}</Link>
            </Button>
          }
        />
      ) : (
        <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      );
  } else {
    body = (
      <>
        <PostCard post={query.data} inThread onDeleted={() => router.replace('/feed')} />
        <Comments postId={id} />
      </>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-4">
      <PageHeader back="/feed" title={t('thread.title')} className="pb-0" />
      {body}
    </div>
  );
}

function Comments({ postId }: { postId: string }) {
  const t = useTranslations('feed');
  const query = useComments(postId);
  return (
    <section aria-labelledby="comments-heading" className="flex flex-col gap-3">
      <h2 id="comments-heading" className="text-lg font-semibold">
        {t('thread.comments')}
      </h2>
      <InfiniteList
        query={query}
        label={t('thread.comments')}
        getKey={(c) => c.id}
        className="overflow-hidden rounded-2xl border bg-card"
        listClassName="[&>li+li]:border-t"
        skeleton={<ListItemSkeleton />}
        skeletonCount={2}
        hideEnd
        empty={<EmptyState icon={MessageCircle} title={t('thread.emptyTitle')} description={t('thread.emptyDescription')} />}
        renderItem={(c) => <CommentItem comment={c} />}
      />
      <CommentComposer postId={postId} />
    </section>
  );
}

function CommentItem({ comment }: { comment: PostCommentDto }) {
  const t = useTranslations('feed');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const errorMessage = useFeedErrorMessage();
  const remove = useDeleteComment(comment.postId);
  const [confirm, setConfirm] = useState(false);
  const [reporting, setReporting] = useState(false);
  const name = comment.author.name || `@${comment.author.nickname}`;
  return (
    <div className="flex items-start gap-3 px-4 py-3" data-testid="comment" data-comment-id={comment.id}>
      <UserAvatar user={{ ...comment.author, name: name }} size="sm" decorative />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <Link href={`/u/${comment.author.id}`} className="font-semibold underline-offset-4 hover:underline focus-ring rounded-sm">
            {name}
          </Link>
          {comment.author.isPremium ? <PremiumBadge compact className="self-center" /> : null}
          <time dateTime={comment.createdAt} className="text-muted-foreground">
            {format.relativeTime(new Date(comment.createdAt), now)}
          </time>
        </p>
        <RichText text={comment.text} />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label={t('comment.menu', { name })} variant="ghost" size="sm" data-testid="comment-menu">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setReporting(true)}>
            <Flag aria-hidden="true" />
            {t('comment.report')}
          </DropdownMenuItem>
          {comment.canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>
                <Trash2 aria-hidden="true" />
                {t('comment.delete')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        tone="danger"
        title={t('comment.deleteTitle')}
        confirmLabel={t('comment.delete')}
        onConfirm={() =>
          remove.mutateAsync(comment.id).then(
            () => notify.success(t('comment.deleted')),
            (e: unknown) => {
              notify.error(errorMessage(e));
              throw e;
            },
          )
        }
      />
      <ReportDialog open={reporting} onOpenChange={setReporting} targetType="comment" targetId={comment.id} />
    </div>
  );
}

function CommentComposer({ postId }: { postId: string }) {
  const t = useTranslations('feed.thread');
  const online = useOnlineStatus();
  const errorMessage = useFeedErrorMessage();
  const add = useAddComment(postId);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return setError(t('commentEmpty'));
    setError(null);
    add.mutate(value, { onSuccess: () => setText(''), onError: (err) => setError(errorMessage(err)) });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-2xl border bg-card p-3" data-testid="comment-composer">
      <Label htmlFor={id}>{t('commentLabel')}</Label>
      <Textarea
        id={id}
        rows={2}
        value={text}
        maxLength={FEED_LIMITS.commentMax}
        showCount={text.length > FEED_LIMITS.commentMax * 0.8}
        placeholder={t('commentPlaceholder')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
        }}
      />
      <FormError>{error}</FormError>
      <Button type="submit" className="self-end" leadingIcon={<Send aria-hidden="true" />} loading={add.isPending} disabled={!online}>
        {t('send')}
      </Button>
    </form>
  );
}
