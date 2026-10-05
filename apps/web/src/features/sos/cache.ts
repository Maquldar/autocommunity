import type { Paginated, SosDto, SosMapItem } from '@autoc/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { isSosOpen } from './view-model';

export const sosKeys = {
  all: ['sos'] as const,
  active: ['sos', 'active'] as const,
  detail: (id: string) => ['sos', 'detail', id] as const,
  nearbyAll: ['sos', 'nearby'] as const,
  nearby: (at: string) => ['sos', 'nearby', at] as const,
  history: ['sos', 'history'] as const,
  mapAll: ['sos', 'map'] as const,
  map: (bbox: string) => ['sos', 'map', bbox] as const,
  public: (token: string) => ['sos', 'public', token] as const,
};

export type SosMapData = { items: SosMapItem[] };

export function toMapItem(sos: SosDto): SosMapItem {
  return { id: sos.id, type: sos.type, lat: sos.lat, lng: sos.lng, status: sos.status, createdAt: sos.createdAt };
}

/**
 * Map layer: `sos:new` inserts (it is newest, so it goes first); `sos:update` changes an existing marker
 * and removes it once the SOS ends. Our own SOS never shows on our map (the API excludes it too).
 */
export function applyToMapItems(items: readonly SosMapItem[], sos: SosDto, insert: boolean): SosMapItem[] {
  const index = items.findIndex((item) => item.id === sos.id);
  const visible = isSosOpen(sos.status) && sos.myRole !== 'requester';
  if (!visible) return index === -1 ? (items as SosMapItem[]) : items.filter((item) => item.id !== sos.id);
  if (index === -1) return insert ? [toMapItem(sos), ...items] : (items as SosMapItem[]);
  const next = [...items];
  next[index] = toMapItem(sos);
  return next;
}

/** Nearby list (helpers): same rules as the map, keeps full DTOs; new ones are inserted by distance. */
export function applyToNearby(list: readonly SosDto[], sos: SosDto, insert: boolean): SosDto[] {
  const index = list.findIndex((item) => item.id === sos.id);
  const visible = isSosOpen(sos.status) && sos.myRole !== 'requester';
  if (!visible) return index === -1 ? (list as SosDto[]) : list.filter((item) => item.id !== sos.id);
  if (index !== -1) {
    const next = [...list];
    next[index] = sos;
    return next;
  }
  if (!insert) return list as SosDto[];
  const next = [...list, sos];
  next.sort((a, b) => (a.distanceM ?? Number.POSITIVE_INFINITY) - (b.distanceM ?? Number.POSITIVE_INFINITY));
  return next;
}

/** GET /sos/active = open SOS where I'm the requester or have a live (offered/accepted/arrived) response. */
export function isActiveForMe(sos: SosDto): boolean {
  if (!isSosOpen(sos.status)) return false;
  if (sos.myRole === 'requester') return true;
  return sos.responses.some((r) => r.status === 'offered' || r.status === 'accepted' || r.status === 'arrived');
}

export function applyToActive(list: readonly SosDto[], sos: SosDto): SosDto[] {
  const without = list.filter((item) => item.id !== sos.id);
  if (!isActiveForMe(sos)) return without;
  const index = list.findIndex((item) => item.id === sos.id);
  if (index === -1) return [sos, ...without];
  const next = [...list];
  next[index] = sos;
  return next;
}

function updateHistory(data: InfiniteData<Paginated<SosDto>> | undefined, sos: SosDto) {
  if (!data) return data;
  let found = false;
  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items.map((item) => {
      if (item.id !== sos.id) return item;
      found = true;
      return sos;
    }),
  }));
  return found ? { ...data, pages } : data;
}

/**
 * Applies an SOS rendered for this viewer (socket `sos:new` / `sos:update`, or a mutation result) to
 * every cached view of it: the detail page, the active list, the nearby list, the map layer and history.
 */
export function applySosToCache(queryClient: QueryClient, sos: SosDto, kind: 'new' | 'update'): void {
  queryClient.setQueryData<SosDto>(sosKeys.detail(sos.id), sos);
  queryClient.setQueryData<SosDto[]>(sosKeys.active, (list) => (list ? applyToActive(list, sos) : list));
  queryClient.setQueriesData<SosDto[]>({ queryKey: sosKeys.nearbyAll }, (list) => (list ? applyToNearby(list, sos, kind === 'new') : list));
  queryClient.setQueriesData<SosMapData>({ queryKey: sosKeys.mapAll }, (data) =>
    data ? { ...data, items: applyToMapItems(data.items, sos, kind === 'new') } : data,
  );
  queryClient.setQueryData<InfiniteData<Paginated<SosDto>>>(sosKeys.history, (data) => updateHistory(data, sos));
  if (kind === 'new' || !isSosOpen(sos.status)) void queryClient.invalidateQueries({ queryKey: sosKeys.history });
}
