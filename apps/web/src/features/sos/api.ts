'use client';

import type { CreateSosInput, Paginated, PublicSosDto, SosDto } from '@autoc/shared';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { queryString } from '@/lib/api/endpoints';
import { useRealtimeConnected } from '@/lib/realtime/realtime-provider';
import { applySosToCache, sosKeys, type SosMapData } from './cache';

const { request } = apiClient;
const enc = encodeURIComponent;

/** API.md §4 endpoints. Kept in the SOS feature (like services) so lib/api stays Phase 1–3. */
export const sosApi = {
  create: (input: CreateSosInput) => request<SosDto>('/sos', { method: 'POST', json: input }),
  active: () => request<SosDto[]>('/sos/active'),
  /** `lat`/`lng` are hints; from Phase 5 the API uses the stored location (409 LOCATION_REQUIRED without one). */
  nearby: (at: { lat: number; lng: number } | null, signal?: AbortSignal) =>
    request<SosDto[]>(`/sos/nearby${queryString({ lat: at?.lat, lng: at?.lng })}`, { signal }),
  map: (bbox: string, signal?: AbortSignal) => request<SosMapData>(`/map/sos${queryString({ bbox })}`, { signal }),
  history: (cursor?: string | null) => request<Paginated<SosDto>>(`/sos/history${queryString({ cursor, limit: 20 })}`),
  get: (id: string) => request<SosDto>(`/sos/${enc(id)}`),
  respond: (id: string) => request<SosDto>(`/sos/${enc(id)}/respond`, { method: 'POST' }),
  withdraw: (id: string) => request<SosDto>(`/sos/${enc(id)}/withdraw`, { method: 'POST' }),
  accept: (id: string, responseId: string) =>
    request<SosDto>(`/sos/${enc(id)}/responses/${enc(responseId)}/accept`, { method: 'POST' }),
  decline: (id: string, responseId: string) =>
    request<SosDto>(`/sos/${enc(id)}/responses/${enc(responseId)}/decline`, { method: 'POST' }),
  arrived: (id: string) => request<SosDto>(`/sos/${enc(id)}/arrived`, { method: 'POST' }),
  close: (id: string) => request<SosDto>(`/sos/${enc(id)}/close`, { method: 'POST' }),
  cancel: (id: string, reason?: string) =>
    request<SosDto>(`/sos/${enc(id)}/cancel`, { method: 'POST', json: reason ? { reason } : {} }),
  share: (id: string) => request<{ url: string }>(`/sos/${enc(id)}/share`, { method: 'POST' }),
  publicView: (token: string) => request<PublicSosDto>(`/public/sos/${enc(token)}`, { auth: false }),
};

/** Live updates come from the socket; polling is only the fallback while it is disconnected. */
function useFallbackInterval(ms: number): number | false {
  return useRealtimeConnected() ? false : ms;
}

export function useActiveSos(enabled = true) {
  return useQuery({ queryKey: sosKeys.active, queryFn: sosApi.active, enabled, staleTime: 10_000 });
}

export function useSos(id: string, enabled = true) {
  const interval = useFallbackInterval(15_000);
  return useQuery({ queryKey: sosKeys.detail(id), queryFn: () => sosApi.get(id), enabled: enabled && Boolean(id), refetchInterval: interval });
}

/** Rounded (~100 m) so GPS jitter doesn't refetch. */
export function nearbyAt(position: { lat: number; lng: number } | null): string {
  return position ? `${position.lat.toFixed(3)},${position.lng.toFixed(3)}` : 'stored';
}

export function useNearbySos(position: { lat: number; lng: number } | null, enabled = true) {
  const at = nearbyAt(position);
  const rounded = position ? { lat: Math.round(position.lat * 1000) / 1000, lng: Math.round(position.lng * 1000) / 1000 } : null;
  return useQuery({
    queryKey: sosKeys.nearby(at),
    queryFn: ({ signal }) => sosApi.nearby(rounded, signal),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useMapSos(bbox: string | null, enabled: boolean) {
  return useQuery({
    queryKey: sosKeys.map(bbox ?? ''),
    queryFn: ({ signal }) => sosApi.map(bbox!, signal),
    enabled: enabled && bbox !== null,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useSosHistory() {
  return useInfiniteQuery({
    queryKey: sosKeys.history,
    queryFn: ({ pageParam }) => sosApi.history(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function usePublicSos(token: string) {
  return useQuery({
    queryKey: sosKeys.public(token),
    queryFn: () => sosApi.publicView(token),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/** Every lifecycle mutation returns the SOS rendered for the caller: apply it everywhere at once. */
function useSosMutation<V>(fn: (variables: V) => Promise<SosDto>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (sos) => applySosToCache(queryClient, sos, 'update'),
  });
}

export function useCreateSos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSosInput) => sosApi.create(input),
    onSuccess: (sos) => {
      applySosToCache(queryClient, sos, 'update');
      queryClient.setQueryData<SosDto[]>(sosKeys.active, (list) => [sos, ...(list ?? []).filter((s) => s.id !== sos.id)]);
    },
  });
}

export const useRespondSos = (id: string) => useSosMutation(() => sosApi.respond(id));
export const useWithdrawSos = (id: string) => useSosMutation(() => sosApi.withdraw(id));
export const useArrivedSos = (id: string) => useSosMutation(() => sosApi.arrived(id));
export const useCloseSos = (id: string) => useSosMutation(() => sosApi.close(id));
export const useCancelSos = (id: string) => useSosMutation((reason: string | undefined) => sosApi.cancel(id, reason));
export const useAcceptResponse = (id: string) => useSosMutation((responseId: string) => sosApi.accept(id, responseId));
export const useDeclineResponse = (id: string) => useSosMutation((responseId: string) => sosApi.decline(id, responseId));

export function useShareSos(id: string) {
  return useMutation({ mutationFn: () => sosApi.share(id) });
}
