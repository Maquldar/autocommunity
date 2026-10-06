'use client';

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { fallbackStyle, mapStyleUrl, webglSupported } from '@/components/services/map-style';

/** Static (non-interactive) map with one pin, plus an OpenStreetMap link; coordinates when WebGL is missing. */
export function MapPreview({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const t = useTranslations('admin.services');
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    if (!webglSupported()) {
      setFailed(true);
      return;
    }
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: mapStyleUrl(document.documentElement.classList.contains('dark')),
        center: [lng, lat],
        zoom: 15,
        interactive: false,
        attributionControl: { compact: true },
      });
    } catch {
      setFailed(true);
      return;
    }
    let usingFallback = false;
    map.on('error', () => {
      if (usingFallback || map.isStyleLoaded()) return;
      usingFallback = true;
      map.setStyle(fallbackStyle(), { diff: false });
    });
    const color = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#1f5ae0';
    new maplibregl.Marker({ color }).setLngLat([lng, lat]).addTo(map);
    return () => map.remove();
  }, [lat, lng]);

  const osm = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
  return (
    <figure className="flex flex-col gap-1.5">
      {failed ? (
        <div className="flex h-40 items-center justify-center gap-2 rounded-xl bg-muted text-sm text-muted-foreground">
          <MapPin aria-hidden="true" className="size-4" />
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </div>
      ) : (
        <div ref={ref} role="img" aria-label={t('mapLabel', { name: label })} className="h-40 overflow-hidden rounded-xl bg-muted" />
      )}
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </span>
        <a href={osm} target="_blank" rel="noreferrer" className="rounded font-medium text-primary underline-offset-4 hover:underline focus-ring">
          {t('openMap')}
        </a>
      </figcaption>
    </figure>
  );
}
