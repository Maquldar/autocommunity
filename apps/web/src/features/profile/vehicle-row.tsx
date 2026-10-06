'use client';

import type { VehicleDto } from '@autoc/shared';
import { CarFront, ChevronRight, Star } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

/**
 * One vehicle: the identity part (photo or icon, name, year · plate) links to the vehicle page; actions sit
 * beside it, never inside the link. The plate appears only when the API returned it (owner/friends).
 */
export function VehicleRow({ vehicle, trailing }: { vehicle: VehicleDto; trailing?: ReactNode }) {
  const t = useTranslations('vehicles');
  const details = [String(vehicle.year), vehicle.plate].filter(Boolean).join(' · ');
  const photo = vehicle.photos?.[0];
  const name = `${vehicle.brand} ${vehicle.model}`;
  return (
    <div data-vehicle={name} className="flex min-h-16 items-center gap-2 px-4 py-3">
      <Link
        href={`/vehicles/${vehicle.id}`}
        className="-m-1 flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 hover:bg-accent focus-ring"
        data-testid="vehicle-link"
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- uploaded media
          <img src={photo.thumbUrl ?? photo.url} alt="" className="size-10 shrink-0 rounded-xl object-cover" />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <CarFront aria-hidden="true" className="size-5" />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[0.9375rem] font-medium text-foreground">{name}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{details}</span>
            {vehicle.isPrimary ? (
              <Badge variant="primary" size="sm">
                <Star aria-hidden="true" />
                {t('primary')}
              </Badge>
            ) : null}
          </span>
        </span>
        {trailing ? null : <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground rtl:rotate-180" />}
      </Link>
      {trailing ? <div className="flex shrink-0 items-center">{trailing}</div> : null}
    </div>
  );
}
