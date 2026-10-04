'use client';

import { useTranslations } from 'next-intl';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

type SpinnerProps = Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
  size?: 'sm' | 'md' | 'lg';
  /** Accessible label. Pass `null` when the spinner sits inside an element that already announces loading. */
  label?: string | null;
};

const sizes = { sm: 'size-4', md: 'size-5', lg: 'size-8' } as const;

export function Spinner({ size = 'md', label, className, ...props }: SpinnerProps) {
  const t = useTranslations('states');
  const accessibleLabel = label === undefined ? t('loading') : label;
  return (
    <span
      role={accessibleLabel ? 'status' : undefined}
      aria-label={accessibleLabel ?? undefined}
      aria-hidden={accessibleLabel ? undefined : true}
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      {...props}
    >
      <SpinnerGlyph className={sizes[size]} />
    </span>
  );
}

/** Bare animated ring, no semantics. Used inside buttons that already set aria-busy. */
export function SpinnerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn('animate-spin motion-reduce:animate-[spin_1.5s_linear_infinite]', className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
