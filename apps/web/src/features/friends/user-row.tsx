'use client';

import type { UserPublic } from '@autoc/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { RatingBadge } from '@/components/ui/rating-badge';
import { Skeleton } from '@/components/ui/skeleton';

type RowUser = Pick<UserPublic, 'id' | 'name' | 'nickname' | 'avatarUrl' | 'rating' | 'primaryVehicle'>;

/**
 * A driver in a list: the identity part links to the profile; actions sit beside it (not inside the
 * link) and wrap below on narrow phones.
 */
export function UserRow({ user, meta, action }: { user: RowUser; meta?: ReactNode; action?: ReactNode }) {
  const car = user.primaryVehicle ? `${user.primaryVehicle.brand} ${user.primaryVehicle.model}` : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <Link
        href={`/u/${user.id}`}
        className="-m-1 flex min-w-0 flex-1 basis-56 items-center gap-3 rounded-xl p-1 hover:bg-accent focus-ring"
      >
        <Avatar id={user.id} name={user.name} src={user.avatarUrl} size="md" decorative />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[0.9375rem] font-medium text-foreground">{user.name}</span>
            <RatingBadge rating={user.rating} size="sm" className="shrink-0" />
          </span>
          <span className="truncate text-sm text-muted-foreground">
            @{user.nickname}
            {car ? ` · ${car}` : null}
          </span>
          {meta ? <span className="truncate text-sm text-muted-foreground">{meta}</span> : null}
        </span>
      </Link>
      {action ? <div className="ms-auto flex shrink-0 items-center">{action}</div> : null}
    </div>
  );
}

export function UserRowSkeleton() {
  return (
    <div aria-hidden="true" className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-40 max-w-full" />
        <Skeleton className="h-3.5 w-28" />
      </div>
      <Skeleton className="h-9 w-28 rounded-lg" />
    </div>
  );
}
