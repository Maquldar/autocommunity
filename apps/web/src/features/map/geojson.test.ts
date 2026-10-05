import type { MapUser } from '@autoc/shared';
import { describe, expect, it } from 'vitest';
import { activeFilterCount, clusterSize, formatClusterCount, sanitizeCommunityIds, toFeatureCollection } from './geojson';

const user = (id: string, extra: Partial<MapUser> = {}): MapUser => ({
  userId: id,
  nickname: id,
  avatarUrl: null,
  rating: 50,
  vehicle: null,
  lat: 43.24,
  lng: 76.89,
  approximate: false,
  relation: 'public',
  updatedAt: '2026-10-05T10:00:00Z',
  ...extra,
});

describe('toFeatureCollection', () => {
  it('maps users to [lng, lat] points with flat properties', () => {
    const fc = toFeatureCollection([user('a', { relation: 'friend', approximate: true, lat: 43.1, lng: 76.5 })]);
    expect(fc.features).toEqual([
      {
        type: 'Feature',
        id: 'a',
        geometry: { type: 'Point', coordinates: [76.5, 43.1] },
        properties: { userId: 'a', relation: 'friend', approximate: true },
      },
    ]);
  });

  it('drops duplicates and invalid coordinates', () => {
    const fc = toFeatureCollection([user('a'), user('a'), user('b', { lat: Number.NaN })]);
    expect(fc.features.map((f) => f.id)).toEqual(['a']);
  });
});

describe('cluster helpers', () => {
  it('grows bubbles with the count, within bounds', () => {
    expect(clusterSize(2)).toBe(40);
    expect(clusterSize(500)).toBe(64);
    expect(clusterSize(20)).toBeGreaterThan(clusterSize(5));
    expect(clusterSize(10_000)).toBe(64);
  });

  it('formats counts', () => {
    expect(formatClusterCount(42)).toBe('42');
    expect(formatClusterCount(1500)).toBe('1k');
  });

  it('counts active filters', () => {
    expect(activeFilterCount({ friends: false, brand: null, communityIds: [] })).toBe(0);
    expect(activeFilterCount({ friends: true, brand: 'Toyota', communityIds: [] })).toBe(2);
    expect(activeFilterCount({ friends: false, brand: null, communityIds: ['a', 'b'] })).toBe(1);
  });
});

describe('sanitizeCommunityIds', () => {
  it('keeps only active communities, deduped and sorted', () => {
    expect(sanitizeCommunityIds(['c', 'a', 'c', 'x'], ['a', 'c'])).toEqual(['a', 'c']);
    expect(sanitizeCommunityIds(['b', 'a'], undefined)).toEqual(['a', 'b']);
    expect(sanitizeCommunityIds([], ['a'])).toEqual([]);
  });
});
