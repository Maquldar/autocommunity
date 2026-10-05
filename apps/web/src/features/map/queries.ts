'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { MapFilters } from './geojson';

export const MAP_REFRESH_MS = 30_000;

export const mapUsersKey = (bbox: string | null, filters: MapFilters) =>
  ['map', 'users', bbox, filters.friends, filters.brand, filters.communityIds.join(',')] as const;

/**
 * Drivers in the (clamped) viewport. Refreshes every 30 s while the tab is visible — TanStack pauses
 * the interval for hidden documents — and keeps showing the previous result while the next loads.
 */
export function useMapUsers(bbox: string | null, filters: MapFilters) {
  return useQuery({
    queryKey: mapUsersKey(bbox, filters),
    queryFn: ({ signal }) =>
      api.map.users(
        {
          bbox: bbox!,
          friends: filters.friends || undefined,
          brand: filters.brand ?? undefined,
          communityIds: filters.communityIds.length > 0 ? filters.communityIds : undefined,
        },
        signal,
      ),
    enabled: bbox !== null,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: MAP_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}
