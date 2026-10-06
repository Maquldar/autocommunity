'use client';

import { CAR_BRANDS, type CommunityDto } from '@autoc/shared';
import { SlidersHorizontal, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { CountBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Avatar } from '@/components/ui/avatar';
import { activeFilterCount, DEFAULT_FILTERS, type MapFilters } from './geojson';

const ANY = '__any';
const BRANDS = Object.keys(CAR_BRANDS).sort((a, b) => a.localeCompare(b));

/** Filters button + sheet: friends only, the viewer's communities (multi-select) and car brand. */
export function MapFiltersControl({
  value,
  onChange,
  communities,
}: {
  value: MapFilters;
  onChange: (next: MapFilters) => void;
  /** The viewer's active communities (undefined while loading). */
  communities: CommunityDto[] | undefined;
}) {
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
        <span className="max-sm:sr-only">{t('button')}</span>
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

          <CommunityFilter
            communities={communities}
            selected={value.communityIds}
            onChange={(communityIds) => onChange({ ...value, communityIds })}
          />

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

function CommunityFilter({
  communities,
  selected,
  onChange,
}: {
  communities: CommunityDto[] | undefined;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations('map.filters');
  const hintId = useId();
  const toggle = (id: string, checked: boolean) =>
    onChange(checked ? [...new Set([...selected, id])].sort() : selected.filter((other) => other !== id));

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={hintId} data-testid="community-filter">
      <legend className="pb-1.5 text-[0.9375rem] font-medium">{t('communities')}</legend>
      <p id={hintId} className="-mt-1 text-sm text-muted-foreground">
        {t('communitiesHint')}
      </p>
      {communities === undefined ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      ) : communities.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">
          <UsersRound aria-hidden="true" className="size-4 shrink-0" />
          <span>
            {t('noCommunities')}{' '}
            <Link href="/communities" className="font-medium text-primary underline-offset-4 hover:underline focus-ring rounded-sm">
              {t('findCommunities')}
            </Link>
          </span>
        </p>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-xl border bg-card [&>li+li]:border-t">
          {communities.map((community) => {
            const checked = selected.includes(community.id);
            return (
              <li key={community.id}>
                <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-ring">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => toggle(community.id, event.target.checked)}
                    className="size-5 shrink-0 cursor-pointer accent-primary focus-visible:outline-none"
                  />
                  <Avatar id={community.id} name={community.name} src={community.avatarUrl} shape="square" size="sm" decorative />
                  <span className="min-w-0 flex-1 truncate text-[0.9375rem]">{community.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
