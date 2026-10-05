'use client';

/** Base map style: NEXT_PUBLIC_MAP_STYLE_URL if set, otherwise OpenFreeMap (liberty / dark), both allowed by the CSP. */
export function mapStyleUrl(dark: boolean): string {
  const custom = process.env.NEXT_PUBLIC_MAP_STYLE_URL;
  if (custom) return custom;
  return dark ? 'https://tiles.openfreemap.org/styles/dark' : 'https://tiles.openfreemap.org/styles/liberty';
}

/** Reads a design token (`--primary`) as a concrete colour for MapLibre paint properties. */
export function cssColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** WebGL is required by MapLibre; old/locked-down browsers fall back to the list. */
export function webglSupported(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** A round "you are here" dot for maplibregl.Marker (token colours via CSS classes). */
export function youAreHereElement(label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'size-4 rounded-full border-[3px] border-card bg-primary shadow-md';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  return el;
}

/**
 * Used when the base style can't be fetched (offline, blocked host): a plain background so service pins
 * still render. It has no glyphs, so text layers must be skipped with it.
 */
export function fallbackStyle(): import('maplibre-gl').StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': cssColor('--muted', '#eaecf0') } }],
  };
}
