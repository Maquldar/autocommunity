'use client';

import type { MapUser } from '@autoc/shared';
import { Heart, UsersRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';
import { clusterSize, formatClusterCount } from './geojson';

/**
 * Map markers are real DOM buttons (focusable, labelled), positioned by MapLibre. Relation is shown by
 * ring colour AND a badge icon (friend ♥ / community 👥); public drivers have a neutral ring and no badge.
 * Approximate positions get a soft dashed circle sized to ~500 m on the ground (`--approx-d`).
 */

const RING: Record<MapUser['relation'], string> = {
  friend: 'ring-primary',
  community: 'ring-success',
  public: 'ring-card',
};

type DriverMarkerUser = Pick<MapUser, 'userId' | 'nickname' | 'avatarUrl' | 'relation' | 'approximate'>;

export function DriverMarker({
  user,
  selected = false,
  onSelect,
}: {
  user: DriverMarkerUser;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const t = useTranslations('map');
  const relation = t(`relation.${user.relation}`);
  const label = `${t('marker.driver', { nickname: `@${user.nickname}`, relation })}${user.approximate ? `, ${t('marker.approximate')}` : ''}`;

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      data-testid="driver-marker"
      data-relation={user.relation}
      data-approximate={user.approximate || undefined}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.();
      }}
      className="group relative flex size-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {user.approximate ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 size-[var(--approx-d,3rem)] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-foreground/35 bg-foreground/10"
        />
      ) : null}
      <span
        className={cn(
          'relative block rounded-full bg-card shadow-md ring-[3px] transition-transform duration-fast ease-standard group-hover:scale-110',
          RING[user.relation],
          user.relation === 'public' && 'outline outline-1 outline-input',
          selected && 'scale-125 shadow-lg',
        )}
      >
        <Avatar id={user.userId} name={user.nickname} src={user.avatarUrl} size="sm" decorative />
      </span>
      {user.relation === 'public' ? null : (
        <span
          aria-hidden="true"
          className={cn(
            'absolute -bottom-0.5 -end-0.5 flex size-[1.125rem] items-center justify-center rounded-full border-2 border-card',
            user.relation === 'friend' ? 'bg-primary text-primary-foreground' : 'bg-success text-success-foreground',
          )}
        >
          {user.relation === 'friend' ? (
            <Heart className="size-2.5" strokeWidth={3} fill="currentColor" />
          ) : (
            <UsersRound className="size-2.5" strokeWidth={3} />
          )}
        </span>
      )}
    </button>
  );
}

export function ClusterMarker({ count, friends = 0, onClick }: { count: number; friends?: number; onClick?: () => void }) {
  const t = useTranslations('map');
  const size = clusterSize(count);
  return (
    <button
      type="button"
      aria-label={t('marker.cluster', { count })}
      data-testid="cluster-marker"
      data-count={count}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      style={{ width: size, height: size }}
      className="relative flex items-center justify-center rounded-full bg-primary text-[0.9375rem] font-semibold tabular-nums text-primary-foreground shadow-md ring-4 ring-primary/25 transition-transform duration-fast ease-standard hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      {formatClusterCount(count)}
      {friends > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -end-1 -top-1 flex size-5 items-center justify-center rounded-full border-2 border-primary bg-card text-primary"
        >
          <Heart className="size-2.5" strokeWidth={3} fill="currentColor" />
        </span>
      ) : null}
    </button>
  );
}

export function OwnPositionMarker() {
  const t = useTranslations('map');
  return (
    <span role="img" aria-label={t('marker.you')} data-testid="own-position" className="relative flex size-5 items-center justify-center">
      <span aria-hidden="true" className="absolute -inset-3 rounded-full bg-primary/20" />
      <span aria-hidden="true" className="relative size-4 rounded-full bg-primary shadow-md ring-[3px] ring-card" />
    </span>
  );
}
