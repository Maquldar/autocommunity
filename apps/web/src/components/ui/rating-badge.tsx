'use client';

import { cva } from 'class-variance-authority';
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { clampRating, getTrustLevel, type TrustLevel } from '@/lib/rating';

const icons = { low: ShieldAlert, medium: Shield, high: ShieldCheck } as const;

const ratingBadgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded-full font-semibold tabular-nums leading-none',
  {
    variants: {
      level: {
        low: 'bg-trust-low-soft text-trust-low-foreground',
        medium: 'bg-trust-medium-soft text-trust-medium-foreground',
        high: 'bg-trust-high-soft text-trust-high-foreground',
      },
      size: {
        sm: 'h-5 px-1.5 text-xs [&_svg]:size-3',
        md: 'h-6 px-2 text-[0.8125rem] [&_svg]:size-3.5',
        lg: 'h-8 px-3 text-sm [&_svg]:size-4',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export type RatingBadgeProps = {
  /** Trust rating 0–100. Values outside the range are clamped. */
  rating: number;
  size?: 'sm' | 'md' | 'lg';
  /** Show the level word ("High") next to the number. */
  showLabel?: boolean;
  className?: string;
};

/** Trust rating pill. Level is conveyed by colour + icon shape + (optional) word + screen-reader text. */
export function RatingBadge({ rating, size, showLabel = false, className }: RatingBadgeProps) {
  const t = useTranslations('rating');
  const value = clampRating(rating);
  const level: TrustLevel = getTrustLevel(value);
  const Icon = icons[level];
  const levelLabel = t(`level.${level}`);

  return (
    <span className={cn(ratingBadgeVariants({ level, size }), className)} data-level={level}>
      <Icon aria-hidden="true" strokeWidth={2.25} />
      <span aria-hidden="true">{value}</span>
      {showLabel ? (
        <span aria-hidden="true" className="font-medium">
          · {levelLabel}
        </span>
      ) : null}
      <span className="sr-only">{t('accessible', { value, level: levelLabel })}</span>
    </span>
  );
}
