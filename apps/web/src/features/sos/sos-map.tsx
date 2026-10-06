'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MlMap, Marker } from 'maplibre-gl';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState } from 'react';
import { fallbackStyle, mapStyleUrl, webglSupported } from '@/components/services/map-style';
import { cn } from '@/lib/cn';

export type LatLng = { lat: number; lng: number };

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** The SOS pin: a red disc with a white core and a card-coloured ring (readable on any tile). */
function sosPinElement(draggable: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.className = cn(
    'flex size-9 items-center justify-center rounded-full bg-sos shadow-lg ring-4 ring-card',
    draggable && 'cursor-grab active:cursor-grabbing',
  );
  el.setAttribute('aria-hidden', 'true');
  el.dataset.testid = 'sos-pin';
  const core = document.createElement('span');
  core.className = 'size-3 rounded-full bg-sos-foreground';
  el.appendChild(core);
  return el;
}

/**
 * Small MapLibre map centred on an SOS. With `onChange` the pin is draggable and a tap on the map moves it
 * (the request flow); without it the map is a static preview. Falls back to a token-coloured tile when
 * WebGL or the style is unavailable, so the coordinates text next to it stays the source of truth.
 */
export function SosMap({
  value,
  onChange,
  label,
  className,
  zoom = 15,
  interactive = true,
  onMapReady,
}: {
  value: LatLng | null;
  onChange?: (next: LatLng) => void;
  label: string;
  className?: string;
  zoom?: number;
  interactive?: boolean;
  /** Gives the parent the map (e.g. "move pin to map centre"). */
  onMapReady?: (map: MlMap | null) => void;
}) {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const libRef = useRef<typeof import('maplibre-gl') | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const draggable = Boolean(onChange);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const start = useRef(value);

  useEffect(() => {
    let disposed = false;
    const container = containerRef.current;
    if (!container) return undefined;
    if (!webglSupported()) {
      setFailed(true);
      return undefined;
    }
    void (async () => {
      const lib = await import('maplibre-gl');
      if (disposed || !containerRef.current) return;
      libRef.current = lib;
      const center = start.current ?? { lat: 43.2389, lng: 76.8897 };
      let map: MlMap;
      try {
        map = new lib.Map({
          container: containerRef.current,
          style: mapStyleUrl(document.documentElement.classList.contains('dark')),
          center: [center.lng, center.lat],
          zoom,
          interactive,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          attributionControl: { compact: true },
        });
      } catch {
        setFailed(true);
        return;
      }
      map.touchZoomRotate.disableRotation();
      mapRef.current = map;
      if (interactive) map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
      let usingFallback = false;
      map.on('error', () => {
        if (usingFallback || map.isStyleLoaded()) return;
        usingFallback = true;
        map.setStyle(fallbackStyle(), { diff: false });
      });
      if (draggable) {
        map.on('click', (e) => onChangeRef.current?.({ lat: round6(e.lngLat.lat), lng: round6(e.lngLat.lng) }));
      }
      setReady(true);
      onMapReady?.(map);
    })();
    return () => {
      disposed = true;
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      onMapReady?.(null);
    };
    // Created once; `zoom`/`interactive` are read at creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !resolvedTheme || !ready) return;
    if (map.isStyleLoaded()) map.setStyle(mapStyleUrl(resolvedTheme === 'dark'));
  }, [resolvedTheme, ready]);

  // Keep the pin on the value; recentre when the value moves out of view.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !ready) return;
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      markerRef.current = new lib.Marker({ element: sosPinElement(draggable), draggable, anchor: 'center' });
      markerRef.current.on('dragend', () => {
        const p = markerRef.current!.getLngLat();
        onChangeRef.current?.({ lat: round6(p.lat), lng: round6(p.lng) });
      });
    }
    markerRef.current.setLngLat([value.lng, value.lat]).addTo(map);
    if (!map.getBounds().contains([value.lng, value.lat])) map.easeTo({ center: [value.lng, value.lat] });
  }, [value, ready, draggable]);

  return (
    <div className={cn('relative w-full overflow-hidden rounded-2xl border bg-muted', className)} data-testid="sos-map" data-ready={ready || undefined}>
      {failed ? (
        <div className="location-tile flex size-full items-center justify-center" role="img" aria-label={label}>
          {value ? <span className="flex size-9 items-center justify-center rounded-full bg-sos shadow-lg ring-4 ring-card"><span className="size-3 rounded-full bg-sos-foreground" /></span> : null}
        </div>
      ) : (
        <div className="absolute inset-0 z-map dark:[&_.maplibregl-ctrl-group]:bg-card! dark:[&_.maplibregl-ctrl-group_button+button]:border-border! dark:[&_.maplibregl-ctrl-icon]:invert">
          <div ref={containerRef} className="size-full" aria-label={label} role="region" />
        </div>
      )}
    </div>
  );
}
