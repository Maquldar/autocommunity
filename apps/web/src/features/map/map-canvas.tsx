'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapUser } from '@autoc/shared';
import type { GeoJSONSource, Map as MlMap, MapGeoJSONFeature, Marker } from 'maplibre-gl';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { APPROXIMATE_RADIUS_M, metersToPixels, type Bounds } from './bbox';
import { CLUSTER_PROPERTIES, toFeatureCollection } from './geojson';
import { loadMapStyle } from './map-style';
import { ClusterMarker, DriverMarker, OwnPositionMarker } from './markers';

export type MapLib = typeof import('maplibre-gl');

const SOURCE = 'drivers';
const HIT_LAYER = 'drivers-hit';

export type MapCanvasHandle = {
  flyTo: (center: { lat: number; lng: number }, zoom?: number) => void;
  zoomBy: (delta: number) => void;
};

export type MapCanvasProps = {
  users: readonly MapUser[];
  initialView: { lat: number; lng: number; zoom: number };
  ownPosition: { lat: number; lng: number } | null;
  selectedId: string | null;
  onSelect: (userId: string) => void;
  /** Debounced after the map stops moving (and once on load). */
  onViewChange: (bounds: Bounds, zoom: number) => void;
  /** The vector style couldn't load (fallback raster) or tiles keep failing. */
  onTilesUnavailable: (unavailable: boolean) => void;
  labels: { region: string; zoomIn: string; zoomOut: string };
  className?: string;
  /** Called once the map and its style are ready (extra layers, e.g. events). */
  onMapReady?: (map: MlMap, lib: MapLib) => void;
};

type MarkerEntry = {
  key: string;
  element: HTMLDivElement;
  marker: Marker;
  lngLat: [number, number];
  cluster: { id: number; count: number; friends: number } | null;
  userId: string | null;
};

type PortalItem = Pick<MarkerEntry, 'key' | 'element' | 'cluster' | 'userId' | 'lngLat'>;

const MOVE_DEBOUNCE_MS = 300;

function boundsOf(map: MlMap): Bounds {
  const b = map.getBounds();
  return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
}

/**
 * MapLibre GL map with a clustered GeoJSON source. Clustering is computed by MapLibre; markers are
 * DOM buttons rendered by React (portals into MapLibre Markers), so they use the design tokens, are
 * keyboard-accessible and don't depend on the style's glyphs/sprites.
 */
export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas(
  { users, initialView, ownPosition, selectedId, onSelect, onViewChange, onTilesUnavailable, labels, className, onMapReady },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const libRef = useRef<MapLib | null>(null);
  const entriesRef = useRef(new Map<string, MarkerEntry>());
  const signatureRef = useRef('');
  const ownMarkerRef = useRef<{ marker: Marker; element: HTMLDivElement } | null>(null);
  const [ready, setReady] = useState(false);
  const [portals, setPortals] = useState<PortalItem[]>([]);
  const [ownElement, setOwnElement] = useState<HTMLDivElement | null>(null);

  // Latest callbacks without re-creating the map.
  const callbacks = useRef({ onViewChange, onTilesUnavailable, onMapReady });
  callbacks.current = { onViewChange, onTilesUnavailable, onMapReady };
  const initial = useRef(initialView);

  const syncMarkers = useCallback(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !map.getSource(SOURCE) || !map.isSourceLoaded(SOURCE)) return;
    const features = map.querySourceFeatures(SOURCE) as MapGeoJSONFeature[];
    const previous = entriesRef.current;
    const next = new Map<string, MarkerEntry>();

    for (const feature of features) {
      if (feature.geometry.type !== 'Point') continue;
      const [lng, lat] = feature.geometry.coordinates as [number, number];
      const props = feature.properties as Record<string, unknown>;
      const isCluster = props.cluster === true;
      const key = isCluster ? `c:${String(props.cluster_id)}` : `u:${String(props.userId)}`;
      if (next.has(key)) continue; // a feature can appear in several tiles

      let entry = previous.get(key);
      if (!entry) {
        const element = document.createElement('div');
        element.className = 'map-marker';
        const marker = new lib.Marker({ element, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);
        entry = { key, element, marker, lngLat: [lng, lat], cluster: null, userId: null };
      } else if (entry.lngLat[0] !== lng || entry.lngLat[1] !== lat) {
        entry.marker.setLngLat([lng, lat]);
        entry.lngLat = [lng, lat];
      }
      entry.cluster = isCluster
        ? { id: Number(props.cluster_id), count: Number(props.point_count), friends: Number(props.friends ?? 0) }
        : null;
      entry.userId = isCluster ? null : String(props.userId);
      // Friends above other drivers, clusters above both.
      entry.element.style.zIndex = isCluster ? '3' : props.relation === 'friend' ? '2' : '1';
      next.set(key, entry);
    }
    for (const [key, entry] of previous) if (!next.has(key)) entry.marker.remove();
    entriesRef.current = next;

    const signature = [...next.values()]
      .map((e) => `${e.key}:${e.cluster ? `${e.cluster.count}/${e.cluster.friends}` : ''}`)
      .sort()
      .join('|');
    if (signature !== signatureRef.current) {
      signatureRef.current = signature;
      setPortals([...next.values()].map(({ key, element, cluster, userId, lngLat }) => ({ key, element, cluster, userId, lngLat })));
    }
  }, []);

  // Create the map once.
  useEffect(() => {
    let disposed = false;
    let moveTimer: ReturnType<typeof setTimeout> | null = null;
    let tileLoaded = false;
    let tileErrors = 0;

    const updateApproxSize = (map: MlMap) => {
      const diameter = 2 * metersToPixels(APPROXIMATE_RADIUS_M, map.getCenter().lat, map.getZoom());
      containerRef.current?.style.setProperty('--approx-d', `${Math.round(Math.min(220, Math.max(58, diameter)))}px`);
    };
    // Settled zoom on the wrapper (`data-zoom`), so tests can wait for an animation to finish instead of sleeping.
    const markZoom = (map: MlMap) => {
      if (wrapperRef.current) wrapperRef.current.dataset.zoom = map.getZoom().toFixed(2);
    };
    const emitView = (map: MlMap) => callbacks.current.onViewChange(boundsOf(map), map.getZoom());

    void (async () => {
      const [lib, { style, fallback }] = await Promise.all([import('maplibre-gl'), loadMapStyle()]);
      if (disposed || !containerRef.current) return;
      const { lat, lng, zoom } = initial.current;
      const map = new lib.Map({
        container: containerRef.current,
        style,
        center: [lng, lat],
        zoom,
        minZoom: 3,
        maxZoom: 18,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: { compact: false },
        locale: { 'Map.Title': labels.region, 'NavigationControl.ZoomIn': labels.zoomIn, 'NavigationControl.ZoomOut': labels.zoomOut },
      });
      map.touchZoomRotate.disableRotation();
      mapRef.current = map;
      libRef.current = lib;
      if (fallback) callbacks.current.onTilesUnavailable(true);

      // `style.load` (not `load`): `load` waits for every tile, and never fires if the tile host is unreachable.
      let setUp = false;
      const setUpSource = () => {
        if (setUp || disposed) return;
        setUp = true;
        map.addSource(SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterRadius: 56,
          clusterMaxZoom: 15,
          clusterProperties: CLUSTER_PROPERTIES as never,
        });
        // Invisible layer: MapLibre only builds a source's tiles (and clusters) when a layer uses it.
        map.addLayer({ id: HIT_LAYER, type: 'circle', source: SOURCE, paint: { 'circle-radius': 1, 'circle-opacity': 0 } });
        updateApproxSize(map);
        markZoom(map);
        setReady(true);
        callbacks.current.onMapReady?.(map, lib);
        emitView(map);
      };
      map.on('style.load', setUpSource);
      map.on('load', setUpSource);
      if (map.isStyleLoaded()) setUpSource();
      map.on('move', () => updateApproxSize(map));
      map.on('moveend', () => {
        markZoom(map);
        if (moveTimer) clearTimeout(moveTimer);
        moveTimer = setTimeout(() => emitView(map), MOVE_DEBOUNCE_MS);
      });
      map.on('sourcedata', (event) => {
        if (event.sourceId === SOURCE && event.isSourceLoaded) syncMarkers();
        if (event.tile && event.sourceId !== SOURCE && !tileLoaded) {
          tileLoaded = true;
          if (!fallback) callbacks.current.onTilesUnavailable(false);
        }
      });
      map.on('idle', syncMarkers);
      map.on('error', () => {
        tileErrors += 1;
        if (!tileLoaded && tileErrors >= 3) callbacks.current.onTilesUnavailable(true);
      });
    })();

    return () => {
      disposed = true;
      if (moveTimer) clearTimeout(moveTimer);
      for (const entry of entriesRef.current.values()) entry.marker.remove();
      entriesRef.current = new Map();
      ownMarkerRef.current?.marker.remove();
      ownMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // The map is created once; labels are only read at creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncMarkers]);

  // Push data into the clustered source.
  useEffect(() => {
    const source = ready ? (mapRef.current?.getSource(SOURCE) as GeoJSONSource | undefined) : undefined;
    if (!source) return;
    void Promise.resolve(source.setData(toFeatureCollection(users) as never)).then(() => syncMarkers());
  }, [ready, users, syncMarkers]);

  // Own position dot.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;
    if (!ownPosition) {
      ownMarkerRef.current?.marker.remove();
      ownMarkerRef.current = null;
      setOwnElement(null);
      return;
    }
    if (!ownMarkerRef.current) {
      const element = document.createElement('div');
      element.className = 'map-marker';
      element.style.zIndex = '4';
      const marker = new lib.Marker({ element, anchor: 'center' }).setLngLat([ownPosition.lng, ownPosition.lat]).addTo(map);
      ownMarkerRef.current = { marker, element };
      setOwnElement(element);
    } else {
      ownMarkerRef.current.marker.setLngLat([ownPosition.lng, ownPosition.lat]);
    }
  }, [ready, ownPosition]);

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (center, zoom) => mapRef.current?.easeTo({ center: [center.lng, center.lat], zoom: zoom ?? Math.max(mapRef.current.getZoom(), 14) }),
      zoomBy: (delta) => {
        const map = mapRef.current;
        if (map) map.easeTo({ zoom: map.getZoom() + delta });
      },
    }),
    [],
  );

  const expandCluster = useCallback(async (clusterId: number, lngLat: [number, number]) => {
    const map = mapRef.current;
    const source = map?.getSource(SOURCE) as GeoJSONSource | undefined;
    if (!map || !source) return;
    let zoom = map.getZoom() + 2;
    try {
      zoom = await source.getClusterExpansionZoom(clusterId);
    } catch {
      // Cluster vanished (data refreshed): just zoom in two levels.
    }
    map.easeTo({ center: lngLat, zoom: Math.min(zoom + 0.5, 18) });
  }, []);

  const usersById = useMemo(() => new Map(users.map((user) => [user.userId, user])), [users]);

  return (
    // MapLibre forces `position: relative` on its container, so positioning lives on this wrapper.
    <div ref={wrapperRef} className={className} data-testid="map-canvas" data-ready={ready || undefined}>
      <div ref={containerRef} className="size-full" />
      {portals.map((item) => {
        if (item.cluster) {
          const { id, count, friends } = item.cluster;
          return createPortal(
            <ClusterMarker count={count} friends={friends} onClick={() => void expandCluster(id, item.lngLat)} />,
            item.element,
            item.key,
          );
        }
        const user = item.userId ? usersById.get(item.userId) : undefined;
        if (!user) return null;
        return createPortal(
          <DriverMarker user={user} selected={selectedId === user.userId} onSelect={() => onSelect(user.userId)} />,
          item.element,
          item.key,
        );
      })}
      {ownElement ? createPortal(<OwnPositionMarker />, ownElement) : null}
    </div>
  );
});
