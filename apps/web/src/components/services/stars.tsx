'use client';

import { Star } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { formatRating } from './format';

/** Five stars for an integer 1–5 (a review). Read as "4 stars". */
export function Stars({ value, className }: { value: number; className?: string }) {
  const t = useTranslations('services.rating');
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} role="img" aria-label={t('starsLabel', { count: value })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={cn('size-4', i <= value ? 'fill-warning text-warning' : 'fill-none text-muted-foreground/60')}
          strokeWidth={1.75}
        />
      ))}
    </span>
  );
}

/** Service rating: a star, the number and (optionally) the review count. "New" while there are no reviews. */
export function RatingSummary({
  rating,
  reviewCount,
  size = 'sm',
  showCount = true,
  className,
}: {
  rating: number;
  reviewCount: number;
  size?: 'sm' | 'lg';
  showCount?: boolean;
  className?: string;
}) {
  const t = useTranslations('services');
  const locale = useLocale();
  const hasReviews = reviewCount > 0;
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5', size === 'lg' ? 'text-base' : 'text-sm', className)}>
      <span className="inline-flex items-center gap-1 font-semibold tabular-nums">
        <Star aria-hidden="true" className={cn(size === 'lg' ? 'size-5' : 'size-4', 'fill-warning text-warning')} strokeWidth={1.75} />
        <span className="sr-only">{t('rating.label', { rating: formatRating(rating, locale) })}</span>
        <span aria-hidden="true">{formatRating(rating, locale)}</span>
      </span>
      {showCount ? (
        <span className="text-muted-foreground">{hasReviews ? t('card.reviews', { count: reviewCount }) : t('rating.new')}</span>
      ) : null}
    </span>
  );
}
