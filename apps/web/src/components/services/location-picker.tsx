'use client';

import { DEFAULT_MAP_CENTER } from '@autoc/shared';
import maplibregl, { type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Crosshair, LocateFixed } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { fallbackStyle, mapStyleUrl, webglSupported } from './map-style';
import { usePosition } from './use-position';

export type LatLng = { lat: number; lng: number };

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Map for placing the service pin: tap/click the map, drag the pin, use the current position or the map centre (keyboard). */
export function LocationPicker({
  value,
  onChange,
  invalid,
  describedBy,
}: {
  value: LatLng | null;
  onChange: (v: LatLng) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('services.submit');
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [failed, setFailed] = useState(false);
  const position = usePosition();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!webglSupported()) {
      setFailed(true);
      return;
    }
    const start = value ?? position.coords ?? DEFAULT_MAP_CENTER;
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container,
        style: mapStyleUrl(document.documentElement.classList.contains('dark')),
        center: [start.lng, start.lat],
        zoom: value || position.coords ? 16 : DEFAULT_MAP_CENTER.zoom,
        attributionControl: { compact: true },
      });
    } catch {
      setFailed(true);
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    let usingFallback = false;
    map.on('error', () => {
      if (usingFallback || map.isStyleLoaded()) return;
      usingFallback = true;
      map.setStyle(fallbackStyle(), { diff: false });
    });
    map.on('click', (e) => onChangeRef.current({ lat: round6(e.lngLat.lat), lng: round6(e.lngLat.lng) }));
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !resolvedTheme) return;
    if (map.isStyleLoaded()) map.setStyle(mapStyleUrl(resolvedTheme === 'dark'));
  }, [resolvedTheme]);

  // Keep the draggable pin in sync with the form value.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ draggable: true, color: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#1f5ae0' });
      markerRef.current.on('dragend', () => {
        const p = markerRef.current!.getLngLat();
        onChangeRef.current({ lat: round6(p.lat), lng: round6(p.lng) });
      });
    }
    markerRef.current.setLngLat([value.lng, value.lat]).addTo(map);
  }, [value]);

  const locateMe = async () => {
    try {
      const c = await position.request();
      onChange({ lat: round6(c.lat), lng: round6(c.lng) });
      mapRef.current?.flyTo({ center: [c.lng, c.lat], zoom: 17 });
    } catch {
      // Reported below.
    }
  };

  const pinAtCentre = () => {
    const c = mapRef.current?.getCenter();
    if (c) onChange({ lat: round6(c.lat), lng: round6(c.lng) });
  };

  return (
    <div className="flex flex-col gap-2">
      {failed ? null : (
        <div
          className={cn('relative h-72 w-full overflow-hidden rounded-xl border bg-muted sm:h-80', invalid && 'border-danger')}
          aria-describedby={describedBy}
        >
          {/* MapLibre forces `position: relative` on its container, so the positioning lives on this wrapper. */}
          <div className="absolute inset-0 z-map dark:[&_.maplibregl-ctrl-group]:bg-card! dark:[&_.maplibregl-ctrl-group_button+button]:border-border! dark:[&_.maplibregl-ctrl-icon]:invert">
            <div ref={containerRef} className="size-full" aria-label={t('mapLabel')} role="region" />
          </div>
          <Crosshair aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 z-raised size-5 -translate-x-1/2 -translate-y-1/2 text-foreground/60" />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" leadingIcon={<LocateFixed aria-hidden="true" />} loading={position.status === 'locating'} onClick={() => void locateMe()}>
          {position.status === 'locating' ? t('locating') : t('useMyLocation')}
        </Button>
        {failed ? null : (
          <Button variant="ghost" size="sm" leadingIcon={<Crosshair aria-hidden="true" />} onClick={pinAtCentre}>
            {t('pinAtCentre')}
          </Button>
        )}
      </div>
      {position.status === 'denied' ? <p className="text-sm text-muted-foreground">{t('locationDenied')}</p> : null}
      {value ? (
        <p className="text-sm tabular-nums text-muted-foreground" data-testid="picked-location">
          {t('locationSet', { lat: value.lat.toFixed(5), lng: value.lng.toFixed(5) })}
        </p>
      ) : null}
    </div>
  );
}
