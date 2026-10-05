'use client';

import type { ServiceListItem } from '@autoc/shared';
import { MapPin } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { CategoryTile } from './category';
import { distanceParts } from './format';
import { OpenBadge } from './open-badge';
import { RatingSummary } from './stars';

export function useDistanceLabel() {
  const format = useFormatter();
  return (meters: number) => {
    const { value, unit } = distanceParts(meters);
    return format.number(value, { style: 'unit', unit, unitDisplay: 'short' });
  };
}

/** A service in the list or the map popup: photo/category tile, name, category, distance, rating, open state. */
export function ServiceCard({ service, className, headingLevel = 2 }: { service: ServiceListItem; className?: string; headingLevel?: 2 | 3 }) {
  const t = useTranslations('services');
  const distance = useDistanceLabel();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <Link
      href={`/services/${service.id}`}
      className={cn(
        'group flex min-w-0 gap-3 rounded-2xl border bg-card p-3 text-card-foreground shadow-sm focus-ring sm:p-4',
        'transition-[box-shadow,border-color] duration-fast ease-standard hover:border-input hover:shadow-md',
        className,
      )}
    >
      {service.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- user media from the API host
        <img src={service.photoUrl} alt="" loading="lazy" className="size-16 shrink-0 rounded-xl bg-muted object-cover sm:size-20" />
      ) : (
        <CategoryTile category={service.category} className="size-16 sm:size-20" iconClassName="size-7" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Heading className="line-clamp-2 break-words text-base font-semibold leading-snug group-hover:text-primary">{service.name}</Heading>
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          <span>{t(`categories.${service.category}`)}</span>
          {service.distanceM !== null ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-0.5 tabular-nums">
                <MapPin aria-hidden="true" className="size-3.5" />
                {t('card.away', { distance: distance(service.distanceM) })}
              </span>
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <RatingSummary rating={service.rating} reviewCount={service.reviewCount} />
          <OpenBadge openNow={service.openNow} />
        </div>
      </div>
    </Link>
  );
}

export function ServiceCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex gap-3 rounded-2xl border bg-card p-3 sm:p-4">
      <Skeleton className="size-16 shrink-0 rounded-xl sm:size-20" />
      <div className="flex flex-1 flex-col gap-2 pt-1">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3.5 w-1/2" />
      </div>
    </div>
  );
}
