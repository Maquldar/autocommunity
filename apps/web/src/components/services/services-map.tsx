'use client';

import {
  DEFAULT_MAP_CENTER,
  SERVICE_CATEGORIES,
  SERVICE_LIMITS,
  type ServiceCategory,
  type ServiceListItem,
  type ServiceMapItem,
} from '@autoc/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LocateFixed, X } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/cn';
import { roundCoords, servicesApi, useService } from './api';
import { CATEGORY_META } from './category';
import { useServiceErrorMessage } from './errors';
import { cssColor, fallbackStyle, mapStyleUrl, webglSupported, youAreHereElement } from './map-style';
import { ServiceCard, ServiceCardSkeleton } from './service-card';
import { usePosition } from './use-position';

type Bbox = [number, number, number, number];
const SOURCE = 'services';
const LAYERS = { clusters: 'svc-clusters', count: 'svc-cluster-count', points: 'svc-points', selected: 'svc-selected' } as const;

/** The visible bounds, clamped around the centre to the API's 2° × 2° limit and rounded (stable query keys). */
export function clampBbox(west: number, south: number, east: number, north: number): Bbox {
  const max = SERVICE_LIMITS.mapMaxSpanDeg - 0.001;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const cx = (west + east) / 2;
  const cy = (south + north) / 2;
  const w = Math.min(east - west, max);
  const h = Math.min(north - south, max);
  return [r(Math.max(-180, cx - w / 2)), r(Math.max(-90, cy - h / 2)), r(Math.min(180, cx + w / 2)), r(Math.min(90, cy + h / 2))];
}

type SourceData = Parameters<GeoJSONSource['setData']>[0];

function toGeoJson(items: ServiceMapItem[]): SourceData {
  return {
    type: 'FeatureCollection',
    features: items.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: { id: s.id, category: s.category, name: s.name },
    })),
  };
}

function addServiceLayers(map: MlMap, withLabels: boolean) {
  if (map.getSource(SOURCE)) return;
  const primary = cssColor('--primary', '#1f5ae0');
  const onPrimary = cssColor('--primary-foreground', '#ffffff');
  const ring = cssColor('--card', '#ffffff');
  const categoryColor: maplibregl.ExpressionSpecification = [
    'match',
    ['get', 'category'],
    ...SERVICE_CATEGORIES.flatMap((c) => [c, cssColor(CATEGORY_META[c].cssVar, '#475467')]),
    '#475467',
  ] as unknown as maplibregl.ExpressionSpecification;

  map.addSource(SOURCE, { type: 'geojson', data: toGeoJson([]), cluster: true, clusterRadius: 48, clusterMaxZoom: 15 });
  map.addLayer({
    id: LAYERS.clusters,
    type: 'circle',
    source: SOURCE,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': primary,
      'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 26],
      'circle-stroke-width': 3,
      'circle-stroke-color': ring,
    },
  });
  if (withLabels) map.addLayer({
    id: LAYERS.count,
    type: 'symbol',
    source: SOURCE,
    filter: ['has', 'point_count'],
    layout: { 'text-field': '{point_count_abbreviated}', 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-allow-overlap': true },
    paint: { 'text-color': onPrimary },
  });
  map.addLayer({
    id: LAYERS.selected,
    type: 'circle',
    source: SOURCE,
    filter: ['==', ['get', 'id'], ''],
    paint: { 'circle-radius': 17, 'circle-color': primary, 'circle-opacity': 0.25 },
  });
  map.addLayer({
    id: LAYERS.points,
    type: 'circle',
    source: SOURCE,
    filter: ['!', ['has', 'point_count']],
    paint: { 'circle-color': categoryColor, 'circle-radius': 9, 'circle-stroke-width': 2.5, 'circle-stroke-color': ring },
  });
}

const detailsToListItem = (s: NonNullable<ReturnType<typeof useService>['data']>): ServiceListItem => ({
  id: s.id,
  name: s.name,
  category: s.category,
  address: s.address,
  phone: s.phone,
  lat: s.lat,
  lng: s.lng,
  rating: s.rating,
  reviewCount: s.reviewCount,
  visitCount: s.visitCount,
  status: s.status,
  distanceM: s.distanceM,
  openNow: s.openNow,
  acceptsPayments: s.acceptsPayments,
  photoUrl: s.photos[0]?.thumbUrl ?? s.photos[0]?.url ?? null,
});

function SelectedCard({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('services.map');
  const position = usePosition();
  const service = useService(id, roundCoords(position.coords));
  return (
    <div className="absolute inset-x-2 bottom-2 z-raised sm:inset-x-auto sm:start-3 sm:bottom-3 sm:w-[24rem]">
      <div className="relative rounded-2xl bg-card shadow-lg">
        {service.data ? <ServiceCard service={detailsToListItem(service.data)} headingLevel={3} className="pe-12" /> : <ServiceCardSkeleton />}
        <IconButton aria-label={t('closeCard')} size="sm" variant="ghost" className="absolute end-1.5 top-1.5" onClick={onClose}>
          <X />
        </IconButton>
      </div>
    </div>
  );
}

/** MapLibre map of verified services: category-coloured pins, clustering, tap → service card. */
export function ServicesMap({ category }: { category: ServiceCategory | undefined }) {
  const t = useTranslations('services');
  const errorMessage = useServiceErrorMessage();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const meMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** Pins + clusters drawn after the last render pass (exposed for e2e as data-rendered). */
  const [rendered, setRendered] = useState(0);
  const position = usePosition({ auto: true });

  const data = useQuery({
    queryKey: ['services', 'map', bbox, category],
    queryFn: ({ signal }) => servicesApi.map(bbox!, category, signal),
    enabled: bbox !== null,
    placeholderData: keepPreviousData,
  });

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!webglSupported()) {
      setFailed(true);
      return;
    }
    let map: MlMap;
    try {
      const start = position.coords ?? { lat: DEFAULT_MAP_CENTER.lat, lng: DEFAULT_MAP_CENTER.lng };
      map = new maplibregl.Map({
        container,
        style: mapStyleUrl(document.documentElement.classList.contains('dark')),
        center: [start.lng, start.lat],
        zoom: position.coords ? 13 : DEFAULT_MAP_CENTER.zoom,
        attributionControl: { compact: true },
        cooperativeGestures: false,
      });
    } catch {
      setFailed(true);
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    const syncBbox = () => {
      const b = map.getBounds();
      setBbox(clampBbox(b.getWest(), b.getSouth(), b.getEast(), b.getNorth()));
    };
    // If the base style can't load, switch to a blank one so the pins still show.
    let usingFallback = false;
    map.on('error', () => {
      if (usingFallback || map.isStyleLoaded()) return;
      usingFallback = true;
      map.setStyle(fallbackStyle(), { diff: false });
    });
    map.on('style.load', () => {
      addServiceLayers(map, !usingFallback);
      setReady(true);
      syncBbox();
    });
    map.on('moveend', syncBbox);
    map.on('idle', () => {
      if (!map.getLayer(LAYERS.points)) return;
      setRendered(map.queryRenderedFeatures({ layers: [LAYERS.points, LAYERS.clusters] }).length);
    });
    map.on('click', LAYERS.points, (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === 'string') setSelected(id);
    });
    map.on('click', LAYERS.clusters, (e) => {
      const feature = e.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      const source = map.getSource<GeoJSONSource>(SOURCE);
      if (!feature || clusterId === undefined || !source) return;
      void source.getClusterExpansionZoom(clusterId).then((zoom) => {
        const [lng, lat] = (feature.geometry as { coordinates: [number, number] }).coordinates;
        map.easeTo({ center: [lng, lat], zoom });
      });
    });
    for (const layer of [LAYERS.points, LAYERS.clusters]) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
    return () => {
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // The initial centre is read once; later position changes move the marker only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme switch: swap the base style; our source/layers are re-added on `style.load`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setReady(false);
    map.setStyle(mapStyleUrl(dark), { diff: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  // Feed the data into the clustered source.
  useEffect(() => {
    const source = ready ? mapRef.current?.getSource<GeoJSONSource>(SOURCE) : undefined;
    if (source && data.data) source.setData(toGeoJson(data.data.items));
  }, [ready, data.data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer(LAYERS.selected)) return;
    map.setFilter(LAYERS.selected, ['==', ['get', 'id'], selected ?? '']);
  }, [ready, selected]);

  // A changed filter can hide the selected service.
  useEffect(() => setSelected(null), [category]);

  // "You are here" marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position.coords) return;
    if (!meMarkerRef.current) meMarkerRef.current = new maplibregl.Marker({ element: youAreHereElement(t('map.you')) });
    meMarkerRef.current.setLngLat([position.coords.lng, position.coords.lat]).addTo(map);
  }, [position.coords, t, ready]);

  const locateMe = async () => {
    try {
      const c = await position.request();
      mapRef.current?.flyTo({ center: [c.lng, c.lat], zoom: Math.max(mapRef.current.getZoom(), 14) });
    } catch {
      // The status line below reports denied/unavailable.
    }
  };

  if (failed) return <ErrorState title={t('map.unavailable')} />;

  const count = data.data?.items.length ?? 0;
  return (
    <section aria-label={t('map.label')} className="flex flex-col gap-2">
      <div className="relative isolate h-[60dvh] min-h-80 w-full overflow-hidden rounded-2xl border bg-muted lg:h-[36rem]">
        {/* MapLibre forces `position: relative` on its container, so the positioning lives on this wrapper. */}
        <div
          className="absolute inset-0 z-map dark:[&_.maplibregl-ctrl-group]:bg-card! dark:[&_.maplibregl-ctrl-group_button+button]:border-border! dark:[&_.maplibregl-ctrl-icon]:invert"
          data-testid="services-map"
          data-ready={ready ? 'true' : 'false'}
          data-count={data.data ? count : undefined}
          data-rendered={rendered}
        >
          <div ref={containerRef} className="size-full" />
        </div>
        <div className="pointer-events-none absolute inset-x-2 top-2 z-raised flex flex-col items-start gap-2">
          {data.isFetching || !ready ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-sm shadow-md">
              <Spinner size="sm" label={t('map.loading')} />
              <span aria-hidden="true">{t('map.loading')}</span>
            </span>
          ) : data.isError ? (
            <div className="pointer-events-auto rounded-2xl bg-card shadow-md">
              <ErrorState compact title={errorMessage(data.error)} onRetry={() => void data.refetch()} />
            </div>
          ) : data.data?.truncated ? (
            <span role="status" className="rounded-full bg-card px-3 py-1.5 text-sm shadow-md">
              {t('map.truncated')}
            </span>
          ) : ready && count === 0 ? (
            <span role="status" className="rounded-full bg-card px-3 py-1.5 text-sm shadow-md">
              {t('map.empty')}
            </span>
          ) : null}
        </div>
        <IconButton
          aria-label={t('location.use')}
          variant="outline"
          className={cn('absolute bottom-3 end-3 z-raised shadow-md', selected && 'max-sm:bottom-auto max-sm:top-24')}
          loading={position.status === 'locating'}
          onClick={() => void locateMe()}
        >
          <LocateFixed />
        </IconButton>
        {selected ? <SelectedCard id={selected} onClose={() => setSelected(null)} /> : null}
      </div>
      {position.status === 'denied' || position.status === 'unavailable' ? (
        <p role="status" className="text-sm text-muted-foreground">
          {position.status === 'denied' ? t('location.denied') : t('location.unavailable')}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">{t('map.hint')}</p>
      <ul aria-label={t('map.legend')} className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {SERVICE_CATEGORIES.map((c) => {
          const Icon = CATEGORY_META[c].icon;
          return (
            <li key={c} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={cn('flex size-5 items-center justify-center rounded-full text-white', CATEGORY_META[c].tile)}>
                <Icon className="size-3" />
              </span>
              {t(`categories.${c}`)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
