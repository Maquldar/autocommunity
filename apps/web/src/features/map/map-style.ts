import type { StyleSpecification } from 'maplibre-gl';

/** Vector style (OpenFreeMap "liberty" by default, overridable with NEXT_PUBLIC_MAP_STYLE_URL). */
export const MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

/**
 * Fallback when the vector style can't be fetched: plain OpenStreetMap raster tiles (also allowed by
 * the CSP). If those fail too, the map is a blank background and drivers still render as DOM markers.
 */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#e9ecf0' } },
    { id: 'osm', type: 'raster', source: 'osm' },
  ],
};

/** Fetches the style JSON with a timeout so a blocked tile host doesn't leave the map blank forever. */
export async function loadMapStyle(
  url = MAP_STYLE_URL,
  { timeoutMs = 8000, fetchImpl = fetch }: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ style: StyleSpecification | string; fallback: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`style ${response.status}`);
    const style = (await response.json()) as StyleSpecification;
    if (!style || style.version !== 8 || !Array.isArray(style.layers)) throw new Error('invalid style');
    return { style, fallback: false };
  } catch {
    return { style: FALLBACK_STYLE, fallback: true };
  } finally {
    clearTimeout(timer);
  }
}
