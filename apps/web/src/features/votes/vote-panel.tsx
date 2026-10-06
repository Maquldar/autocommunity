'use client';

import { VOTE_LIMITS, type VoteReason, type VoteSummaryDto, type VoteValue } from '@autoc/shared';
import { CircleAlert, Info, ThumbsDown, ThumbsUp, Vote } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { useCastVote, useVoteSummary } from './api';
import { daysUntil, reasonChips, reasonsFor, voteError, voteNotice } from './view-model';

/** Counts (👍 / 👎) and one chip per reason that has votes. Voters are never shown. */
export function VoteCounts({ summary }: { summary: Pick<VoteSummaryDto, 'up' | 'down' | 'byReason'> }) {
  const t = useTranslations('votes');
  const chips = reasonChips(summary.byReason);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" data-testid="vote-counts">
        <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-success-soft px-3 text-sm font-semibold text-success-soft-foreground" data-testid="votes-up" data-count={summary.up}>
          <ThumbsUp aria-hidden="true" className="size-4" />
          {t('up', { count: summary.up })}
        </span>
        <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-danger-soft px-3 text-sm font-semibold text-danger-soft-foreground" data-testid="votes-down" data-count={summary.down}>
          <ThumbsDown aria-hidden="true" className="size-4" />
          {t('down', { count: summary.down })}
        </span>
      </div>
      {chips.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('reasonsLabel')}>
          {chips.map((chip) => (
            <li
              key={chip.reason}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm',
                chip.tone === 'positive' ? 'border-success/40' : chip.tone === 'negative' ? 'border-danger/40' : 'border-border',
              )}
              data-reason={chip.reason}
            >
              {chip.tone === 'positive' ? <ThumbsUp aria-hidden="true" className="size-3.5 text-success" /> : chip.tone === 'negative' ? <ThumbsDown aria-hidden="true" className="size-3.5 text-danger" /> : null}
              <span>{t(`reasons.${chip.reason}`)}</span>
              <span className="font-semibold tabular-nums">{chip.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Another driver's profile: the summary, then the vote buttons or why the viewer can't vote. */
export function VotePanel({ userId, name }: { userId: string; name: string }) {
  const t = useTranslations('votes');
  const query = useVoteSummary(userId);
  const [dialog, setDialog] = useState<VoteValue | null>(null);

  return (
    <section aria-labelledby="votes-heading" className="flex flex-col gap-3" data-testid="vote-panel">
      <h2 id="votes-heading" className="text-xl font-semibold tracking-tight">
        {t('title')}
      </h2>
      {query.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : query.isError ? (
        <ErrorState compact onRetry={() => void query.refetch()} retrying={query.isFetching} className="rounded-2xl border bg-card" />
      ) : (
        <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4">
          <VoteCounts summary={query.data} />
          <VoteAction summary={query.data} name={name} onVote={setDialog} />
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t('anonymous', { days: VOTE_LIMITS.cooldownDays })}
          </p>
        </div>
      )}
      <VoteDialog userId={userId} name={name} value={dialog} onClose={() => setDialog(null)} />
    </section>
  );
}

function VoteAction({ summary, name, onVote }: { summary: VoteSummaryDto; name: string; onVote: (v: VoteValue) => void }) {
  const t = useTranslations('votes');
  const online = useOnlineStatus();
  const notice = voteNotice(summary);
  const mine = summary.myVote;

  if (mine) {
    const days = daysUntil(mine.canVoteAgainAt);
    return (
      <div role="status" className="flex flex-col gap-1 rounded-xl bg-muted/60 p-3 text-sm" data-testid="my-vote" data-value={mine.value}>
        <p className="flex items-center gap-2 font-medium">
          {mine.value === 1 ? <ThumbsUp aria-hidden="true" className="size-4 text-success" /> : <ThumbsDown aria-hidden="true" className="size-4 text-danger" />}
          {t('myVote', { value: mine.value === 1 ? 'up' : 'down', reason: t(`reasons.${mine.reason}`) })}
        </p>
        <p className="text-muted-foreground" data-testid="vote-again">
          {days > 0 ? t('againIn', { days }) : t('againNow')}
        </p>
      </div>
    );
  }
  if (notice) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground" data-testid="vote-eligibility" data-eligibility={summary.eligibility}>
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t(`notice.${notice.key}`, 'values' in notice ? notice.values : undefined)}
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <Button variant="outline" leadingIcon={<ThumbsUp aria-hidden="true" />} onClick={() => onVote(1)} disabled={!online} data-testid="vote-up">
        {t('voteUp')}
      </Button>
      <Button variant="outline" leadingIcon={<ThumbsDown aria-hidden="true" />} onClick={() => onVote(-1)} disabled={!online} data-testid="vote-down">
        {t('voteDown')}
      </Button>
      <span className="sr-only">{t('voteFor', { name })}</span>
    </div>
  );
}

function VoteDialog({ userId, name, value, onClose }: { userId: string; name: string; value: VoteValue | null; onClose: () => void }) {
  const t = useTranslations('votes');
  const errorMessage = useErrorMessage();
  const online = useOnlineStatus();
  const cast = useCastVote(userId);
  const groupId = useId();
  const [reason, setReason] = useState<VoteReason | null>(null);
  const [comment, setComment] = useState('');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (value === null) return;
    setReason(null);
    setComment('');
    setMissing(false);
    setError(null);
  }, [value]);

  const mapped = error ? voteError(error) : null;
  const errorText = error ? (mapped ? t(`errors.${mapped.key}`, mapped.values) : errorMessage(error)) : null;

  const submit = async () => {
    if (value === null) return;
    if (!reason) {
      setMissing(true);
      return;
    }
    setError(null);
    try {
      await cast.mutateAsync({ value, reason, comment: comment.trim() || undefined });
      notify.success(t('sent'));
      onClose();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Dialog open={value !== null} onOpenChange={(open) => (!open && !cast.isPending ? onClose() : undefined)}>
      <DialogContent data-testid="vote-dialog">
        {value !== null ? (
          <>
            <DialogHeader>
              <DialogTitle>{value === 1 ? t('dialog.titleUp', { name }) : t('dialog.titleDown', { name })}</DialogTitle>
              <DialogDescription>{t('dialog.description', { days: VOTE_LIMITS.cooldownDays })}</DialogDescription>
            </DialogHeader>
            <form
              noValidate
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <fieldset className="flex flex-col gap-2">
                <legend id={groupId} className="mb-1 text-[0.9375rem] font-medium">
                  {t('dialog.reason')}
                </legend>
                <RadioGroup
                  value={reason ?? ''}
                  onValueChange={(v) => {
                    setReason(v as VoteReason);
                    setMissing(false);
                  }}
                  aria-labelledby={groupId}
                  aria-invalid={missing || undefined}
                  className="flex flex-col gap-1"
                >
                  {reasonsFor(value).map((r) => (
                    <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent">
                      <RadioGroupItem value={r} aria-labelledby={`${groupId}-${r}`} />
                      <span id={`${groupId}-${r}`} className="text-[0.9375rem]">
                        {t(`reasons.${r}`)}
                      </span>
                    </label>
                  ))}
                </RadioGroup>
                {missing ? (
                  <p className="flex items-center gap-1.5 text-sm text-danger">
                    <CircleAlert aria-hidden="true" className="size-4" />
                    {t('dialog.reasonRequired')}
                  </p>
                ) : null}
              </fieldset>
              <FormField label={t('dialog.comment')} hint={t('dialog.commentHint')}>
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={VOTE_LIMITS.commentMax} showCount rows={3} />
              </FormField>
              {errorText ? (
                <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground" data-testid="vote-error">
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {errorText}
                </p>
              ) : null}
              <DialogFooter>
                <Button variant="secondary" onClick={onClose} disabled={cast.isPending}>
                  {t('dialog.cancel')}
                </Button>
                <Button type="submit" loading={cast.isPending} disabled={!online} leadingIcon={value === 1 ? <ThumbsUp aria-hidden="true" /> : <ThumbsDown aria-hidden="true" />}>
                  {t('dialog.submit')}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Own profile (?tab=votes): what others think, without who. */
export function ReceivedVotes({ userId }: { userId: string }) {
  const t = useTranslations('votes');
  const query = useVoteSummary(userId);
  return (
    <section aria-labelledby="received-votes-heading" className="flex flex-col gap-3" data-testid="received-votes">
      <h2 id="received-votes-heading" className="text-xl font-semibold tracking-tight">
        {t('receivedTitle')}
      </h2>
      <p className="-mt-1 text-sm text-muted-foreground">{t('receivedHint')}</p>
      {query.isPending ? (
        <div aria-busy="true" className="rounded-2xl border bg-card p-4">
          <Skeleton className="h-9 w-48" />
        </div>
      ) : query.isError ? (
        <ErrorState compact onRetry={() => void query.refetch()} retrying={query.isFetching} className="rounded-2xl border bg-card" />
      ) : query.data.up + query.data.down === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border bg-card px-4 py-8 text-center">
          <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
            <Vote className="size-6" />
          </span>
          <p className="font-medium">{t('emptyTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('emptyHint')}</p>
        </div>
      ) : (
        <div className="rounded-2xl border bg-card p-4">
          <VoteCounts summary={query.data} />
        </div>
      )}
    </section>
  );
}
