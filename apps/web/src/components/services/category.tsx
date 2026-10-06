import type { ServiceCategory } from '@autoc/shared';
import { Cog, Disc3, Droplets, Fuel, Truck, Wrench, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Category icon + colour. Colours reuse the avatar palette (white text/icons ≥ 5.4:1 in both themes) and
 * never SOS red; the icon shape and the label always accompany the colour.
 */
export const CATEGORY_META: Record<ServiceCategory, { icon: LucideIcon; tile: string; cssVar: string }> = {
  repair: { icon: Wrench, tile: 'bg-avatar-1', cssVar: '--avatar-1' },
  tires: { icon: Disc3, tile: 'bg-avatar-3', cssVar: '--avatar-3' },
  wash: { icon: Droplets, tile: 'bg-avatar-6', cssVar: '--avatar-6' },
  parts: { icon: Cog, tile: 'bg-avatar-5', cssVar: '--avatar-5' },
  tow: { icon: Truck, tile: 'bg-avatar-4', cssVar: '--avatar-4' },
  fuel: { icon: Fuel, tile: 'bg-avatar-2', cssVar: '--avatar-2' },
};

export function CategoryTile({ category, className, iconClassName }: { category: ServiceCategory; className?: string; iconClassName?: string }) {
  const { icon: Icon, tile } = CATEGORY_META[category];
  return (
    <span aria-hidden="true" className={cn('flex shrink-0 items-center justify-center rounded-xl text-white', tile, className)}>
      <Icon className={cn('size-6', iconClassName)} strokeWidth={1.75} />
    </span>
  );
}
