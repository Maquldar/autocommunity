'use client';

import type { VehicleDto } from '@autoc/shared';
import { CarFront, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { ListItem } from '@/components/ui/list-item';

/** One vehicle as a static list row. The plate appears only when the API returned it (owner/friends). */
export function VehicleRow({ vehicle, trailing }: { vehicle: VehicleDto; trailing?: ReactNode }) {
  const t = useTranslations('vehicles');
  const details = [String(vehicle.year), vehicle.plate].filter(Boolean).join(' · ');
  return (
    <div data-vehicle={`${vehicle.brand} ${vehicle.model}`}>
      <ListItem
      leading={
        <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <CarFront aria-hidden="true" className="size-5" />
        </span>
      }
      title={`${vehicle.brand} ${vehicle.model}`}
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{details}</span>
          {vehicle.isPrimary ? (
            <Badge variant="primary" size="sm">
              <Star aria-hidden="true" />
              {t('primary')}
            </Badge>
          ) : null}
        </span>
      }
      trailing={trailing}
      />
    </div>
  );
}
