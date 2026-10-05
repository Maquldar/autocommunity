'use client';

import { CAR_BRANDS } from '@autoc/shared';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { CountBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { activeFilterCount, DEFAULT_FILTERS, type MapFilters } from './geojson';

const ANY = '__any';
const BRANDS = Object.keys(CAR_BRANDS).sort((a, b) => a.localeCompare(b));

/** Filters button + sheet: friends only and car brand. (Community filter arrives with communities, Phase 3.) */
export function MapFiltersControl({ value, onChange }: { value: MapFilters; onChange: (next: MapFilters) => void }) {
  const t = useTranslations('map.filters');
  const [open, setOpen] = useState(false);
  const friendsId = useId();
  const brandId = useId();
  const count = activeFilterCount(value);

  return (
    <>
      <Button
        variant="outline"
        className="bg-card shadow-md"
        leadingIcon={<SlidersHorizontal aria-hidden="true" />}
        aria-label={count > 0 ? t('buttonActive', { count }) : undefined}
        onClick={() => setOpen(true)}
        data-testid="map-filters-button"
      >
        <span className="max-[22rem]:sr-only">{t('button')}</span>
        {count > 0 ? <CountBadge aria-hidden="true" count={count} className="bg-primary text-primary-foreground" /> : null}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t('title')}</SheetTitle>
            <SheetDescription>{t('description')}</SheetDescription>
          </SheetHeader>

          <div className="flex items-start justify-between gap-4 rounded-xl border bg-card p-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Label htmlFor={friendsId} className="text-[0.9375rem]">
                {t('friendsOnly')}
              </Label>
              <p id={`${friendsId}-hint`} className="text-sm text-muted-foreground">
                {t('friendsOnlyHint')}
              </p>
            </div>
            <Switch
              id={friendsId}
              checked={value.friends}
              onCheckedChange={(friends) => onChange({ ...value, friends })}
              aria-describedby={`${friendsId}-hint`}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={brandId}>{t('brand')}</Label>
            <Select value={value.brand ?? ANY} onValueChange={(brand) => onChange({ ...value, brand: brand === ANY ? null : brand })}>
              <SelectTrigger id={brandId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('anyBrand')}</SelectItem>
                {BRANDS.map((brand) => (
                  <SelectItem key={brand} value={brand}>
                    {brand}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <SheetFooter>
            <Button fullWidth size="lg" onClick={() => setOpen(false)}>
              {t('apply')}
            </Button>
            <Button fullWidth variant="ghost" disabled={count === 0} onClick={() => onChange(DEFAULT_FILTERS)}>
              {t('reset')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
