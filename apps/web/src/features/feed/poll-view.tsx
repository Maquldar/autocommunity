'use client';

import type { PollDto } from '@autoc/shared';
import { Check, ListChecks } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { useVote } from './api';
import { useFeedErrorMessage } from './errors';
import { pollResults } from './poll-math';

/**
 * Poll: before voting, radio (single) or checkbox (multiple) options and a Vote button; after voting (final),
 * result bars with percentages, the viewer's choices marked with a check and the word "your vote".
 */
export function PollView({ postId, poll }: { postId: string; poll: PollDto }) {
  const t = useTranslations('feed.poll');
  const online = useOnlineStatus();
  const errorMessage = useFeedErrorMessage();
  const vote = useVote(postId);
  const [picked, setPicked] = useState<string[]>([]);
  const name = useId();
  const voted = poll.myVotes.length > 0;

  const submit = () =>
    vote.mutate(picked, {
      onError: (error) => notify.error(errorMessage(error)),
    });

  return (
    <fieldset className="flex flex-col gap-2 rounded-xl border bg-background p-3" data-testid="poll">
      <legend className="sr-only">{poll.question}</legend>
      <p className="flex items-start gap-2 font-semibold" aria-hidden="true">
        <ListChecks className="mt-0.5 size-5 shrink-0 text-primary" />
        <span className="break-words">{poll.question}</span>
      </p>
      {voted ? (
        <ul className="flex flex-col gap-2" aria-label={t('results')}>
          {pollResults(poll).map((row) => (
            <li key={row.id} className="relative overflow-hidden rounded-lg border bg-card" data-testid="poll-result">
              <span
                aria-hidden="true"
                className={cn('absolute inset-y-0 start-0 transition-[width] duration-slow', row.mine ? 'bg-primary-soft' : 'bg-muted')}
                style={{ width: `${row.percent}%` }}
              />
              <span className="relative flex min-h-11 items-center gap-2 px-3 py-2 text-sm">
                {row.mine ? <Check aria-hidden="true" className="size-4 shrink-0 text-primary" /> : null}
                <span className={cn('min-w-0 flex-1 break-words', row.leading && 'font-semibold')}>
                  {row.text}
                  {row.mine ? <span className="sr-only"> ({t('yourVote')})</span> : null}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{row.percent}%</span>
                <span className="sr-only">{t('votes', { count: row.voteCount })}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-1.5" role={poll.multiple ? 'group' : 'radiogroup'} aria-label={poll.question}>
          {poll.options.map((o) => {
            const checked = picked.includes(o.id);
            return (
              <label key={o.id} className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm hover:bg-accent', checked && 'border-primary bg-primary-soft/40')}>
                <input
                  type={poll.multiple ? 'checkbox' : 'radio'}
                  name={name}
                  checked={checked}
                  onChange={(e) =>
                    setPicked((p) => (poll.multiple ? (e.target.checked ? [...p, o.id] : p.filter((x) => x !== o.id)) : [o.id]))
                  }
                  className="size-4 shrink-0 accent-[var(--primary)]"
                />
                <span className="min-w-0 break-words">{o.text}</span>
              </label>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {t('voters', { count: poll.totalVoters })}
          {poll.multiple ? ` · ${t('multiple')}` : ''}
        </span>
        {voted ? (
          <span>{t('final')}</span>
        ) : (
          <Button size="sm" onClick={submit} disabled={!picked.length || !online} loading={vote.isPending}>
            {t('vote')}
          </Button>
        )}
      </div>
    </fieldset>
  );
}
