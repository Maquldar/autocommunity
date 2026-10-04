import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Placeholder block. Skeletons must mirror the shape of the content they replace.
 * They are aria-hidden; the loading container announces itself (aria-busy + sr-only text).
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('skeleton-shimmer animate-shimmer rounded-md motion-reduce:animate-none', className)}
      {...props}
    />
  );
}

/** Skeleton for a ListItem row with an avatar: matches ListItem's paddings and heights. */
export function ListItemSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('flex min-h-16 items-center gap-3 px-4 py-3', className)}>
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}

/** Skeleton for a content card with title, two text lines and media. */
export function CardSkeleton({ className, withMedia = false }: { className?: string; withMedia?: boolean }) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5', className)}>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-4/5" />
      {withMedia ? <Skeleton className="aspect-video w-full rounded-xl" /> : null}
    </div>
  );
}
