import type { MapUser } from '@autoc/shared';

/**
 * MapUser[] → GeoJSON for the clustered MapLibre source. Properties stay flat (MapLibre serializes
 * nested objects); the full MapUser is looked up by `userId` when a marker renders.
 */
export type DriverProperties = { userId: string; relation: MapUser['relation']; approximate: boolean };

export type DriverFeature = {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: DriverProperties;
};

export type DriverCollection = { type: 'FeatureCollection'; features: DriverFeature[] };

export function toFeatureCollection(users: readonly MapUser[]): DriverCollection {
  const seen = new Set<string>();
  const features: DriverFeature[] = [];
  for (const user of users) {
    if (seen.has(user.userId) || !Number.isFinite(user.lat) || !Number.isFinite(user.lng)) continue;
    seen.add(user.userId);
    features.push({
      type: 'Feature',
      id: user.userId,
      geometry: { type: 'Point', coordinates: [user.lng, user.lat] },
      properties: { userId: user.userId, relation: user.relation, approximate: user.approximate },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Cluster aggregate: how many friends a cluster holds (drawn as a heart dot on the bubble). */
export const CLUSTER_PROPERTIES = {
  friends: ['+', ['case', ['==', ['get', 'relation'], 'friend'], 1, 0]],
} as const;

/** Bubble diameter grows with the log of the count, from 40 px (2) to 64 px (500). */
export function clusterSize(count: number): number {
  const clamped = Math.max(2, Math.min(500, count));
  return Math.round(40 + (24 * Math.log(clamped / 2)) / Math.log(250));
}

/** Short count for the bubble: 999+ never appears (max 500 per response), 1000+ → "1k". */
export function formatClusterCount(count: number): string {
  return count >= 1000 ? `${Math.floor(count / 1000)}k` : String(count);
}

/** `communityIds`: members of any of these communities (only the viewer's active ones are honoured). */
export type MapFilters = { friends: boolean; brand: string | null; communityIds: string[] };
export const DEFAULT_FILTERS: MapFilters = { friends: false, brand: null, communityIds: [] };

export function activeFilterCount(filters: MapFilters): number {
  return (filters.friends ? 1 : 0) + (filters.brand ? 1 : 0) + (filters.communityIds.length > 0 ? 1 : 0);
}

/**
 * Drops community ids the viewer is no longer an active member of (the API answers 403 for those),
 * keeping the result sorted so the query key is stable. `activeIds` undefined = not loaded yet.
 */
export function sanitizeCommunityIds(ids: readonly string[], activeIds: readonly string[] | undefined): string[] {
  const unique = [...new Set(ids)];
  const kept = activeIds ? unique.filter((id) => activeIds.includes(id)) : unique;
  return kept.sort();
}
