'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import type { RoutePoint } from '@autoc/shared';
import type { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { loadMapStyle } from '@/features/map/map-style';

type LatLng = { lat: number; lng: number };

const ROUTE_SOURCE = 'event-route';

function tokenColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function routeData(route: readonly RoutePoint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: [
      ...(route.length >= 2 ? [{ type: 'Feature' as const, properties: { kind: 'line' }, geometry: { type: 'LineString' as const, coordinates: route.map((p) => [...p]) } }] : []),
      ...route.map((p, i) => ({
        type: 'Feature' as const,
        properties: { kind: i === 0 ? 'start' : i === route.length - 1 ? 'end' : 'point' },
        geometry: { type: 'Point' as const, coordinates: [...p] },
      })),
    ],
  };
}

/** A pin element (token colours) for the event place. */
function pinElement(label: string): HTMLDivElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  el.dataset.testid = 'event-place-marker';
  el.innerHTML =
    '<svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true"><path d="M17 43c-1-6-16-16-16-26a16 16 0 0 1 32 0c0 10-15 20-16 26z" fill="var(--primary)" stroke="var(--card)" stroke-width="2"/><circle cx="17" cy="17" r="6" fill="var(--card)"/></svg>';
  return el;
}

/**
 * MapLibre map of an event: the place pin and the route (line + numbered vertices). With `onPick` taps
 * report coordinates (create / edit form). Without WebGL or tiles it degrades to a plain background;
 * the coordinates are always shown as text next to it by the caller.
 */
export function EventMap({
  place,
  route,
  onPick,
  label,
  placeLabel,
  className,
  fitOnChange = false,
  editing = false,
}: {
  place: LatLng | null;
  route: readonly RoutePoint[];
  onPick?: (p: LatLng) => void;
  label: string;
  placeLabel: string;
  className?: string;
  /** Re-fit the view to place + route whenever they change (details page). */
  fitOnChange?: boolean;
  /** Show every route vertex (form). */
  editing?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const libRef = useRef<typeof import('maplibre-gl') | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const initial = useRef({ place, route });

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const [lib, { style }] = await Promise.all([import('maplibre-gl'), loadMapStyle()]);
        if (disposed || !containerRef.current) return;
        const start = initial.current.place ?? (initial.current.route[0] ? { lng: initial.current.route[0][0], lat: initial.current.route[0][1] } : null);
        const map = new lib.Map({
          container: containerRef.current,
          style,
          center: start ? [start.lng, start.lat] : [76.9286, 43.2567],
          zoom: start ? 13 : 11,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          cooperativeGestures: !pickRef.current,
          // Taps add points in the form: a quick second tap must not zoom.
          doubleClickZoom: !pickRef.current,
          attributionControl: { compact: true },
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
        libRef.current = lib;
        mapRef.current = map;
        const setUp = () => {
          if (map.getSource(ROUTE_SOURCE)) return;
          const primary = tokenColor('--primary', '#1f5ae0');
          map.addSource(ROUTE_SOURCE, { type: 'geojson', data: routeData([]) as never });
          map.addLayer({
            id: 'event-route-casing',
            type: 'line',
            source: ROUTE_SOURCE,
            filter: ['==', ['get', 'kind'], 'line'],
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 },
          });
          map.addLayer({
            id: 'event-route-line',
            type: 'line',
            source: ROUTE_SOURCE,
            filter: ['==', ['get', 'kind'], 'line'],
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': primary, 'line-width': 4.5 },
          });
          map.addLayer({
            id: 'event-route-points',
            type: 'circle',
            source: ROUTE_SOURCE,
            filter: ['!=', ['get', 'kind'], 'line'],
            paint: {
              'circle-radius': ['match', ['get', 'kind'], 'start', 7, 'end', 7, 4.5],
              'circle-color': ['match', ['get', 'kind'], 'end', tokenColor('--success', '#15803d'), primary],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2,
            },
          });
          setReady(true);
        };
        map.on('style.load', setUp);
        map.on('load', setUp);
        if (map.isStyleLoaded()) setUp();
        map.on('click', (e) => pickRef.current?.({ lat: Math.round(e.lngLat.lat * 1e6) / 1e6, lng: Math.round(e.lngLat.lng * 1e6) / 1e6 }));
      } catch {
        if (!disposed) setFailed(true);
      }
    })();
    return () => {
      disposed = true;
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Route line and vertices.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const source = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
    const shown = editing ? route : route.length >= 2 ? [route[0]!, ...route.slice(1, -1), route[route.length - 1]!] : route;
    source?.setData(routeData(shown) as never);
    if (map.getLayer('event-route-points')) {
      map.setFilter('event-route-points', editing ? ['!=', ['get', 'kind'], 'line'] : ['in', ['get', 'kind'], ['literal', ['start', 'end']]]);
    }
  }, [ready, route, editing]);

  // Place pin.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;
    if (!place) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) markerRef.current = new lib.Marker({ element: pinElement(placeLabel), anchor: 'bottom' });
    markerRef.current.setLngLat([place.lng, place.lat]).addTo(map);
  }, [ready, place, placeLabel]);

  // Fit to place + route: once when ready (forms), or on every change (details page).
  const fitKey = fitOnChange ? JSON.stringify([place, route]) : 'once';
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;
    const points: [number, number][] = [...route.map((p) => [p[0], p[1]] as [number, number]), ...(place ? [[place.lng, place.lat] as [number, number]] : [])];
    if (points.length >= 2) {
      const bounds = points.reduce((b, p) => b.extend(p), new lib.LngLatBounds(points[0]!, points[0]!));
      map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
    } else if (points.length === 1) {
      map.jumpTo({ center: points[0]!, zoom: 14 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitKey]);

  if (failed) return null;
  return (
    <div className={cn('map-canvas relative overflow-hidden rounded-xl border bg-muted', className)} data-testid="event-map" data-ready={ready || undefined}>
      <div ref={containerRef} className="size-full" role="region" aria-label={label} />
    </div>
  );
}
