'use client';

import { DEFAULT_MAP_CENTER } from '@autoc/shared';
import { AlertCircle, ChevronRight, LocateFixed, MapPinned, Minus, Plus, Siren, WifiOff, ZoomIn } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { SpinnerGlyph } from '@/components/ui/spinner';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { cn } from '@/lib/cn';
import { useLocationSharing } from '@/lib/location/location-provider';
import { bboxParam, toQueryBounds, type Bounds } from './bbox';
import { DriverCard } from './driver-card';
import { useMyCommunities } from '@/features/communities/queries';
import { DEFAULT_FILTERS, sanitizeCommunityIds, type MapFilters } from './geojson';
import { LocationControls } from './location-controls';
import { MapCanvas, type MapCanvasHandle, type MapLib } from './map-canvas';
import type { Map as MlMap } from 'maplibre-gl';
import { EventsMapLayer } from '@/features/events/events-map-layer';
import { EventsLayerToggle, useEventsLayer } from '@/features/events/events-layer-toggle';
import { MapFiltersControl } from './map-filters';
import { PrivacyToggle } from './privacy-toggle';
import { useMapUsers } from './queries';
import { useMapSos } from '@/features/sos/api';
import { SosMapSheet } from '@/features/sos/map-sheet';

const FILTERS_KEY = 'autoc:map-filters';
const SOS_LAYER_KEY = 'autoc:map-sos-layer';

function readSosLayer(): boolean {
  try {
    return window.localStorage.getItem(SOS_LAYER_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeSosLayer(on: boolean) {
  try {
    window.localStorage.setItem(SOS_LAYER_KEY, on ? '1' : '0');
  } catch {
    // Per-viewer convenience only.
  }
}

function readFilters(): MapFilters {
  try {
    const raw = window.localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<MapFilters>;
    return {
      friends: parsed.friends === true,
      brand: typeof parsed.brand === 'string' && parsed.brand ? parsed.brand : null,
      communityIds: Array.isArray(parsed.communityIds) ? parsed.communityIds.filter((id): id is string => typeof id === 'string') : [],
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function writeFilters(filters: MapFilters) {
  try {
    window.localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Per-viewer convenience only.
  }
}

/** Live map of drivers (SPEC flow 2): clustered markers, filters, invisibility toggle, location sharing. */
export function MapView() {
  const t = useTranslations('map');
  const online = useOnlineStatus();
  const { position, status: locationStatus } = useLocationSharing();
  const canvasRef = useRef<MapCanvasHandle>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [filters, setFiltersState] = useState<MapFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tilesUnavailable, setTilesUnavailable] = useState(false);
  const centeredOnUser = useRef(false);
  const [mapHandle, setMapHandle] = useState<{ map: MlMap; lib: MapLib } | null>(null);
  const [showEvents, setShowEvents] = useEventsLayer();
  const onMapReady = useCallback((map: MlMap, lib: MapLib) => setMapHandle({ map, lib }), []);
  const movedByUser = useRef(false);
  const [sosLayer, setSosLayerState] = useState(true);
  const [selectedSosId, setSelectedSosId] = useState<string | null>(null);

  useEffect(() => setFiltersState(readFilters()), []);
  useEffect(() => setSosLayerState(readSosLayer()), []);
  const toggleSosLayer = useCallback(() => {
    setSosLayerState((on) => {
      writeSosLayer(!on);
      return !on;
    });
  }, []);
  const setFilters = useCallback((next: MapFilters) => {
    setFiltersState(next);
    writeFilters(next);
  }, []);

  // Community filter: only the viewer's active communities (a stale id would make the API answer 403).
  const myCommunities = useMyCommunities();
  const activeCommunities = useMemo(
    () => myCommunities.data?.filter((c) => c.myMembership?.status === 'active'),
    [myCommunities.data],
  );
  const effectiveFilters = useMemo<MapFilters>(() => {
    const communityIds = sanitizeCommunityIds(filters.communityIds, activeCommunities?.map((c) => c.id));
    return { ...filters, communityIds };
  }, [filters, activeCommunities]);

  const queryBounds = useMemo(() => (bounds ? toQueryBounds(bounds) : null), [bounds]);
  const tooLarge = bounds !== null && queryBounds === null;
  const bbox = queryBounds ? bboxParam(queryBounds) : null;
  // Wait for the membership list before sending a community filter.
  const query = useMapUsers(filters.communityIds.length > 0 && !activeCommunities && !myCommunities.isError ? null : bbox, effectiveFilters);
  // Zoomed out too far: show nothing rather than stale markers from a smaller area.
  const users = useMemo(() => (tooLarge ? [] : (query.data?.items ?? [])), [tooLarge, query.data]);
  const selected = useMemo(() => users.find((u) => u.userId === selectedId) ?? null, [users, selectedId]);
  // SOS layer (API.md §4/§5: open SOS near the viewer; an empty list when they have no fresh location).
  const sosQuery = useMapSos(bbox, sosLayer && !tooLarge);
  const sosItems = useMemo(() => (sosLayer && !tooLarge ? (sosQuery.data?.items ?? []) : []), [sosLayer, tooLarge, sosQuery.data]);

  // Centre on the driver's first fix once, unless they already moved the map themselves.
  useEffect(() => {
    if (!position || centeredOnUser.current) return;
    centeredOnUser.current = true;
    if (!movedByUser.current) canvasRef.current?.flyTo(position, 14);
  }, [position]);

  const onViewChange = useCallback((next: Bounds) => {
    setBounds((current) => {
      if (current) movedByUser.current = true;
      return next;
    });
  }, []);

  const initialView = useMemo(() => ({ lat: DEFAULT_MAP_CENTER.lat, lng: DEFAULT_MAP_CENTER.lng, zoom: DEFAULT_MAP_CENTER.zoom }), []);

  return (
    // Fills <main>; on phones it stops above the bottom tab bar.
    <div
      className="absolute inset-x-0 top-0 bottom-[calc(var(--nav-height)+var(--safe-bottom))] overflow-hidden lg:bottom-0"
      data-testid="map-view"
    >
      <h1 className="sr-only">{t('title')}</h1>
      <MapCanvas
        ref={canvasRef}
        className="map-canvas absolute inset-0 z-map"
        users={users}
        initialView={initialView}
        ownPosition={position}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedSosId(null);
          setSelectedId(id);
        }}
        sosItems={sosItems}
        selectedSosId={selectedSosId}
        onSelectSos={(id) => {
          setSelectedId(null);
          setSelectedSosId(id);
        }}
        onViewChange={onViewChange}
        onTilesUnavailable={setTilesUnavailable}
        labels={{ region: t('regionLabel'), zoomIn: t('zoomInControl'), zoomOut: t('zoomOutControl') }}
        onMapReady={onMapReady}
      />
      <EventsMapLayer map={mapHandle?.map ?? null} lib={mapHandle?.lib ?? null} bbox={tooLarge ? null : bbox} enabled={showEvents} />

      {/* Top: visibility + filters, then the status pill. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-raised flex flex-col items-center gap-2 p-3 sm:p-4">
        <div className="flex w-full items-start justify-between gap-2">
          <PrivacyToggle className="pointer-events-auto min-w-0" />
          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            <EventsLayerToggle pressed={showEvents} onPressedChange={setShowEvents} />
            <button
              type="button"
              aria-pressed={sosLayer}
              aria-label={sosLayer ? t('sosLayer.hide') : t('sosLayer.show')}
              data-testid="map-sos-toggle"
              onClick={toggleSosLayer}
              className={cn(
                'inline-flex h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold shadow-md transition-colors duration-fast focus-ring',
                sosLayer ? 'border-sos bg-sos-soft text-sos-soft-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              <Siren aria-hidden="true" className="size-4" />
              {t('sosLayer.label')}
            </button>
            <MapFiltersControl value={effectiveFilters} onChange={setFilters} communities={activeCommunities} />
          </div>
        </div>
        <MapStatus
          online={online}
          tooLarge={tooLarge}
          loading={bbox !== null && (query.isPending || (query.isFetching && query.isPlaceholderData))}
          error={query.isError && !query.data}
          retrying={query.isFetching}
          onRetry={() => void query.refetch()}
          onZoomIn={() => canvasRef.current?.zoomBy(2)}
          count={query.data && !tooLarge ? users.length : null}
          truncated={Boolean(query.data?.truncated) && !tooLarge}
          tilesUnavailable={tilesUnavailable}
        />
        {sosItems.length > 0 ? (
          <Link
            href="/sos/nearby"
            data-testid="map-sos-count"
            className="pointer-events-auto flex max-w-full items-center gap-1.5 rounded-full border border-sos bg-card px-3.5 py-1.5 text-sm font-semibold text-sos-soft-foreground shadow-md hover:bg-sos-soft focus-ring"
          >
            <Siren aria-hidden="true" className="size-4 shrink-0" />
            {t('sosLayer.count', { count: sosItems.length })}
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 rtl:rotate-180" />
          </Link>
        ) : null}
      </div>

      {/* Bottom: location sharing (left) and map buttons (right), above the attribution. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-raised flex items-end gap-2 p-3 pb-9 sm:p-4 sm:pb-9">
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <LocationControls className="max-w-md" />
        </div>
        <div className="pointer-events-auto flex shrink-0 flex-col gap-2">
          <div className="hidden flex-col overflow-hidden rounded-full border bg-card shadow-md lg:flex">
            <IconButton aria-label={t('zoomInControl')} className="rounded-none" onClick={() => canvasRef.current?.zoomBy(1)}>
              <Plus />
            </IconButton>
            <IconButton aria-label={t('zoomOutControl')} className="rounded-none border-t" onClick={() => canvasRef.current?.zoomBy(-1)}>
              <Minus />
            </IconButton>
          </div>
          {position && locationStatus !== 'off' ? (
            <IconButton aria-label={t('recenter')} variant="outline" className="bg-card shadow-md" onClick={() => canvasRef.current?.flyTo(position, 15)}>
              <LocateFixed />
            </IconButton>
          ) : null}
        </div>
      </div>

      <DriverCard driver={selected} onClose={() => setSelectedId(null)} />
      <SosMapSheet sosId={selectedSosId} onClose={() => setSelectedSosId(null)} />
    </div>
  );
}

function Pill({ children, tone = 'default', testId }: { children: ReactNode; tone?: 'default' | 'warning' | 'danger'; testId?: string }) {
  return (
    <div
      role="status"
      data-testid={testId}
      className={cn(
        'pointer-events-auto flex max-w-full items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium shadow-md',
        tone === 'default' && 'bg-card text-foreground',
        tone === 'warning' && 'border-warning bg-warning-soft text-warning-soft-foreground',
        tone === 'danger' && 'border-danger bg-danger-soft text-danger-soft-foreground',
      )}
    >
      {children}
    </div>
  );
}

function MapStatus(props: {
  online: boolean;
  tooLarge: boolean;
  loading: boolean;
  error: boolean;
  retrying: boolean;
  onRetry: () => void;
  onZoomIn: () => void;
  count: number | null;
  truncated: boolean;
  tilesUnavailable: boolean;
}) {
  const t = useTranslations('map');
  const tc = useTranslations('common');
  const { online, tooLarge, loading, error, retrying, onRetry, onZoomIn, count, truncated, tilesUnavailable } = props;

  let main: ReactNode;
  if (!online) {
    main = (
      <Pill tone="warning" testId="map-offline">
        <WifiOff aria-hidden="true" className="size-4 shrink-0" />
        <span className="text-pretty">{t('offline')}</span>
      </Pill>
    );
  } else if (tooLarge) {
    main = (
      <Pill testId="map-zoom-hint">
        <ZoomIn aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        {t('zoomIn')}
        <Button size="sm" variant="link" onClick={onZoomIn} className="ms-1">
          {t('zoomInAction')}
        </Button>
      </Pill>
    );
  } else if (error) {
    main = (
      <Pill tone="danger" testId="map-error">
        <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
        {t('error')}
        <Button size="sm" variant="link" onClick={onRetry} disabled={retrying} className="ms-1 text-danger-soft-foreground">
          {retrying ? <SpinnerGlyph /> : null}
          {tc('retry')}
        </Button>
      </Pill>
    );
  } else if (loading || count === null) {
    main = (
      <Pill testId="map-loading">
        <SpinnerGlyph />
        {t('loading')}
      </Pill>
    );
  } else if (count === 0) {
    main = (
      <Pill testId="map-empty">
        <MapPinned aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span>
          {t('empty')}
          <span className="font-normal text-muted-foreground"> · {t('emptyHint')}</span>
        </span>
      </Pill>
    );
  } else {
    main = (
      <Pill testId="map-count">
        <span data-count={count}>{t('count', { count })}</span>
      </Pill>
    );
  }

  return (
    <div className="flex max-w-full flex-col items-center gap-2">
      {main}
      {truncated && count ? (
        <p className="pointer-events-auto rounded-full bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm">{t('truncated', { count })}</p>
      ) : null}
      {tilesUnavailable ? (
        <p role="status" className="pointer-events-auto rounded-full bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm">
          {t('tilesUnavailable')}
        </p>
      ) : null}
    </div>
  );
}
