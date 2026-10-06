'use client';

import type { EventMapItem } from '@autoc/shared';
import { CalendarDays, Check, ChevronRight, X } from 'lucide-react';
import type { Map as MlMap, Marker } from 'maplibre-gl';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/cn';
import type { MapLib } from '@/features/map/map-canvas';
import { useMapEvents } from './api';
import { calendarTile, formatEventWhen } from './time';

type Entry = { marker: Marker; element: HTMLDivElement };

/**
 * Upcoming events (next 7 days) as a toggleable layer on the main map: DOM markers (calendar pins) placed
 * with MapLibre, and a small card for the selected event. Uses the map's current query bbox.
 */
export function EventsMapLayer({ map, lib, bbox, enabled }: { map: MlMap | null; lib: MapLib | null; bbox: string | null; enabled: boolean }) {
  const t = useTranslations('events');
  const locale = useLocale();
  // ~100 m grid so tiny pans reuse the cached answer.
  const rounded = useMemo(() => (bbox ? bbox.split(',').map((v) => Number(v).toFixed(3)).join(',') : null), [bbox]);
  const query = useMapEvents(rounded, enabled);
  const items = useMemo(() => (enabled ? (query.data?.items ?? []) : []), [enabled, query.data]);
  const entries = useRef(new Map<string, Entry>());
  const [portals, setPortals] = useState<{ id: string; element: HTMLDivElement }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!map || !lib) return;
    const next = new Map<string, Entry>();
    for (const item of items) {
      let entry = entries.current.get(item.id);
      if (!entry) {
        const element = document.createElement('div');
        element.className = 'map-marker';
        element.style.zIndex = '5';
        const marker = new lib.Marker({ element, anchor: 'bottom' }).setLngLat([item.lng, item.lat]).addTo(map);
        // The button inside is the control; MapLibre's own role/label on the wrapper would nest buttons.
        for (const attr of ['role', 'aria-label', 'tabindex']) element.removeAttribute(attr);
        entry = { element, marker };
      } else {
        entry.marker.setLngLat([item.lng, item.lat]);
      }
      next.set(item.id, entry);
    }
    for (const [id, entry] of entries.current) if (!next.has(id)) entry.marker.remove();
    entries.current = next;
    setPortals([...next.entries()].map(([id, e]) => ({ id, element: e.element })));
  }, [map, lib, items]);

  useEffect(
    () => () => {
      for (const entry of entries.current.values()) entry.marker.remove();
      entries.current = new Map();
    },
    [],
  );

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  return (
    <>
      {portals.map(({ id, element }) => {
        const item = byId.get(id);
        if (!item) return null;
        const tile = calendarTile(item.startsAt, locale);
        return createPortal(
          <button
            type="button"
            data-testid="event-marker"
            aria-label={t('map.marker', { title: item.title, when: formatEventWhen(item.startsAt, null, locale) })}
            aria-pressed={selectedId === item.id}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedId(item.id);
            }}
            className="group flex flex-col items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span
              className={cn(
                'flex w-10 flex-col items-center overflow-hidden rounded-lg border-2 bg-card text-center shadow-md transition-transform duration-fast group-hover:scale-110',
                selectedId === item.id ? 'border-primary' : 'border-card',
              )}
            >
              <span className="w-full bg-primary text-[0.5625rem] font-semibold uppercase leading-3.5 text-primary-foreground">{tile.month}</span>
              <span className="text-sm font-semibold leading-5 tabular-nums">{tile.day}</span>
            </span>
            <span aria-hidden="true" className="-mt-px h-2 w-0.5 bg-primary" />
          </button>,
          element,
          id,
        );
      })}
      {selected ? <EventMapCard item={selected} onClose={() => setSelectedId(null)} /> : null}
    </>
  );
}

function EventMapCard({ item, onClose }: { item: EventMapItem; onClose: () => void }) {
  const t = useTranslations('events');
  const tc = useTranslations('common');
  const locale = useLocale();
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-raised flex justify-center px-3 sm:bottom-28">
      <div role="dialog" aria-label={item.title} className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border bg-card p-3 shadow-lg" data-testid="event-map-card">
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
          <CalendarDays className="size-5" />
        </span>
        <Link href={`/events/${item.id}`} className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg focus-ring">
          <span className="font-semibold leading-snug break-words">{item.title}</span>
          <span className="text-sm tabular-nums">{formatEventWhen(item.startsAt, null, locale)}</span>
          <span className="truncate text-sm text-muted-foreground">
            {item.communityName} · {t('goingCount', { count: item.goingCount })}
          </span>
          {item.myRsvp === 'going' ? (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
              <Check aria-hidden="true" className="size-4" />
              {t('rsvp.going')}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-0.5 text-sm font-medium text-primary">
            {t('map.open')}
            <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
          </span>
        </Link>
        <IconButton aria-label={tc('close')} size="sm" variant="ghost" onClick={onClose}>
          <X />
        </IconButton>
      </div>
    </div>
  );
}
