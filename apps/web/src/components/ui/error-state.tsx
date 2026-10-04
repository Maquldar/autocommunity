'use client';

import { RotateCw, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';

export type ErrorStateProps = {
  title?: ReactNode;
  description?: ReactNode;
  /** Retry callback (e.g. `query.refetch`). When omitted no retry button is shown. */
  onRetry?: () => void;
  retrying?: boolean;
  /** Compact inline variant for use inside lists ("Couldn't load more"). */
  compact?: boolean;
  className?: string;
};

export function ErrorState({ title, description, onRetry, retrying = false, compact = false, className }: ErrorStateProps) {
  const t = useTranslations();
  const heading = title ?? t('errors.loadFailed');
  const retryButton = onRetry ? (
    <Button
      variant={compact ? 'ghost' : 'outline'}
      size={compact ? 'sm' : 'md'}
      onClick={onRetry}
      loading={retrying}
      leadingIcon={<RotateCw aria-hidden="true" />}
    >
      {t('common.retry')}
    </Button>
  ) : null;

  if (compact) {
    return (
      <div role="alert" className={cn('flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-3 text-sm', className)}>
        <span className="flex items-center gap-1.5 text-danger">
          <TriangleAlert aria-hidden="true" className="size-4" />
          {heading}
        </span>
        {retryButton}
      </div>
    );
  }

  return (
    <div role="alert" className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-danger-soft text-danger-soft-foreground">
        <TriangleAlert aria-hidden="true" className="size-7" strokeWidth={1.75} />
      </div>
      <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
      <p className="mt-1.5 max-w-sm text-[0.9375rem] text-muted-foreground">{description ?? t('errors.tryAgainHint')}</p>
      {retryButton ? <div className="mt-6">{retryButton}</div> : null}
    </div>
  );
}
