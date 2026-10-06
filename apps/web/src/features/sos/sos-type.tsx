'use client';

import type { SosStatus, SosType } from '@autoc/shared';
import { BatteryWarning, CarFront, CircleHelp, Disc3, Fuel, Snowflake, Truck, Wrench, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { isSosOpen } from './view-model';

export const SOS_TYPE_ICONS: Record<SosType, LucideIcon> = {
  flat_tire: Disc3,
  battery: BatteryWarning,
  fuel: Fuel,
  stuck: Snowflake,
  breakdown: Wrench,
  accident: CarFront,
  tow: Truck,
  other: CircleHelp,
};

/** SOS type in a soft SOS-red tile (the situation), sized for cards (md) or list rows (sm). */
export function SosTypeTile({ type, size = 'md', className }: { type: SosType; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const Icon = SOS_TYPE_ICONS[type];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl bg-sos-soft text-sos-soft-foreground',
        size === 'sm' && 'size-10',
        size === 'md' && 'size-12',
        size === 'lg' && 'size-14 rounded-2xl',
        className,
      )}
    >
      <Icon className={size === 'lg' ? 'size-7' : size === 'md' ? 'size-6' : 'size-5'} />
    </span>
  );
}

/**
 * Status as a badge: open SOS use the SOS badge with a live dot (pulsing only while nobody has accepted),
 * resolved is success, cancelled/expired neutral. Always a word, never colour alone.
 */
export function SosStatusBadge({ status, className }: { status: SosStatus; className?: string }) {
  const t = useTranslations('sos.status');
  if (isSosOpen(status)) {
    return (
      <Badge variant="sos" className={className} data-testid="sos-status" data-status={status}>
        <span
          aria-hidden="true"
          className={cn('size-2 rounded-full bg-sos-foreground', status === 'created' && 'motion-safe:animate-sos-pulse')}
        />
        {t(status)}
      </Badge>
    );
  }
  return (
    <Badge variant={status === 'closed' ? 'success' : 'neutral'} className={className} data-testid="sos-status" data-status={status}>
      {t(status)}
    </Badge>
  );
}
