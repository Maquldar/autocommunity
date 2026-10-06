'use client';

import type { VoteTrait, VoteTraitsDto } from '@autoc/shared';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment } from 'react';
import { cn } from '@/lib/cn';
import { useVoteSummary } from './api';

/** "Подрезает" → "подрезает" (the labels are sentence case; inside the line they follow a colon). */
export function lowerFirst(text: string, locale: string): string {
  return text ? text.charAt(0).toLocaleLowerCase(locale) + text.slice(1) : text;
}

const TONE = {
  negative: 'bg-danger-soft text-danger-soft-foreground',
  positive: 'bg-success-soft text-success-soft-foreground',
} as const;

/**
 * One line under the profile name/bio: "Часто отмечают: подрезает · не включает поворотники · хвалят: пропускает".
 * Negative traits in danger-tinted chips, positive ones in success-tinted chips; the lead words carry the
 * meaning too, so colour is never the only signal. Renders nothing without traits (the API already hides
 * them below 3 voters). Voters are never shown.
 */
export function VoteTraitsLine({ traits, className }: { traits: VoteTraitsDto | null | undefined; className?: string }) {
  const t = useTranslations('votes');
  const locale = useLocale();
  const negative = traits?.negative ?? [];
  const positive = traits?.positive ?? [];
  if (!negative.length && !positive.length) return null;

  const chips = (list: VoteTrait[], tone: keyof typeof TONE) =>
    list.map((trait, i) => (
      <Fragment key={trait.reason}>
        {i > 0 ? <span aria-hidden="true"> · </span> : ' '}
        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 font-medium', TONE[tone])} data-tone={tone} data-reason={trait.reason}>
          {lowerFirst(t(`reasons.${trait.reason}`), locale)}
        </span>
      </Fragment>
    ));

  return (
    <p className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground', className)} data-testid="vote-traits">
      {negative.length ? (
        <>
          <span>{t('traits.negativeLead')}</span>
          {chips(negative, 'negative')}
        </>
      ) : null}
      {negative.length && positive.length ? <span aria-hidden="true"> · </span> : null}
      {positive.length ? (
        <>
          <span>{negative.length ? t('traits.positiveLead') : t('traits.positiveLeadFirst')}</span>
          {chips(positive, 'positive')}
        </>
      ) : null}
    </p>
  );
}

/** The traits line for a profile, from the votes summary (shares the query with the vote panel). */
export function VoteTraits({ userId, className }: { userId: string; className?: string }) {
  const query = useVoteSummary(userId);
  return <VoteTraitsLine traits={query.data?.traits} className={className} />;
}
