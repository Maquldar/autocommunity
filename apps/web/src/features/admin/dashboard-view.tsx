'use client';

import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useAdminStats } from './api';
import { statTiles, type StatTile } from './view-models';

const GROUPS = ['users', 'sos', 'moderation'] as const;

/** /admin — the MVP success metrics (PLAN §8) the data supports, grouped, with links to the queues. */
export function DashboardView() {
  const t = useTranslations('admin.dashboard');
  const locale = useLocale();
  const stats = useAdminStats();
  const units = { h: t('units.h'), m: t('units.m'), s: t('units.s') };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('description')} />
      {stats.isPending ? (
        <div aria-busy="true" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <span className="sr-only">{t('loading')}</span>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : stats.isError ? (
        <ErrorState onRetry={() => void stats.refetch()} retrying={stats.isFetching} className="rounded-2xl border bg-card" />
      ) : (
        GROUPS.map((group) => {
          const tiles = statTiles(stats.data, { locale, units }).filter((tile) => tile.group === group);
          return (
            <section key={group} aria-labelledby={`stats-${group}`} className="flex flex-col gap-3">
              <h2 id={`stats-${group}`} className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`groups.${group}`)}
              </h2>
              <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {tiles.map((tile) => (
                  <li key={tile.key}>
                    <Tile tile={tile} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

function Tile({ tile }: { tile: StatTile }) {
  const t = useTranslations('admin.dashboard.tiles');
  const body = (
    <>
      <span className="flex items-start justify-between gap-2 text-sm text-muted-foreground">
        <span>{t(`${tile.key}.label`)}</span>
        {tile.href ? <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 opacity-60 group-hover:opacity-100" /> : null}
      </span>
      <span className={cn('text-2xl font-semibold tabular-nums tracking-tight', tile.attention && 'text-warning-soft-foreground')} data-testid={`stat-${tile.key}`}>
        {tile.value}
      </span>
      <span className="text-xs text-muted-foreground">{t(`${tile.key}.hint`)}</span>
    </>
  );
  const cls = cn(
    'group flex h-full min-h-24 flex-col gap-1 rounded-2xl border bg-card p-4',
    tile.attention && 'border-warning/60 bg-warning-soft/30',
  );
  return tile.href ? (
    <Link href={tile.href} className={cn(cls, 'transition-colors duration-fast hover:border-input hover:bg-accent focus-ring')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
