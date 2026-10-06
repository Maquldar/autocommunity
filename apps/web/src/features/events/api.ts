'use client';

import type {
  EventDto,
  EventMapResult,
  EventParticipantDto,
  Paginated,
  RoutePoint,
  RsvpStatus,
} from '@autoc/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { queryString } from '@/lib/api/endpoints';
import { invalidateChatLists } from '@/features/chats/cache';

const { request } = apiClient;
const enc = encodeURIComponent;

export type EventScope = 'upcoming' | 'past';

/** What the create / edit form sends (times as ISO strings; the API validates again). */
export type EventBody = {
  title: string;
  description: string;
  place: string;
  lat: number;
  lng: number;
  startsAt: string;
  endsAt: string | null;
  route: RoutePoint[] | null;
};

/** API.md §8 events endpoints (kept in the feature so `lib/api/endpoints.ts` stays untouched). */
export const eventsApi = {
  list: (p: { scope: EventScope; communityId?: string | null; cursor?: string | null }) =>
    request<Paginated<EventDto>>(`/events${queryString({ scope: p.scope, communityId: p.communityId, cursor: p.cursor, limit: 20 })}`),
  get: (id: string) => request<EventDto>(`/events/${enc(id)}`),
  create: (communityId: string, body: EventBody) =>
    request<EventDto>(`/communities/${enc(communityId)}/events`, { method: 'POST', json: { ...body, endsAt: body.endsAt ?? undefined, route: body.route ?? undefined } }),
  update: (id: string, body: Partial<EventBody>) => request<EventDto>(`/events/${enc(id)}`, { method: 'PATCH', json: body }),
  remove: (id: string) => request<void>(`/events/${enc(id)}`, { method: 'DELETE' }),
  rsvp: (id: string, status: RsvpStatus | 'none') => request<EventDto>(`/events/${enc(id)}/rsvp`, { method: 'POST', json: { status } }),
  participants: (id: string, cursor?: string | null) =>
    request<Paginated<EventParticipantDto>>(`/events/${enc(id)}/participants${queryString({ cursor, limit: 30 })}`),
  map: (bbox: string, signal?: AbortSignal) => request<EventMapResult>(`/map/events${queryString({ bbox })}`, { signal }),
};

export const eventKeys = {
  all: ['events'] as const,
  list: (scope: EventScope, communityId: string | null) => ['events', 'list', scope, communityId] as const,
  detail: (id: string) => ['events', 'detail', id] as const,
  participants: (id: string) => ['events', 'detail', id, 'participants'] as const,
  map: (bbox: string | null) => ['events', 'map', bbox] as const,
};

const pageOptions = {
  initialPageParam: null as string | null,
  getNextPageParam: (last: Paginated<unknown>) => last.nextCursor,
};

export function useEvents(scope: EventScope, communityId: string | null = null, enabled = true) {
  return useInfiniteQuery({
    queryKey: eventKeys.list(scope, communityId),
    queryFn: ({ pageParam }) => eventsApi.list({ scope, communityId, cursor: pageParam }),
    placeholderData: keepPreviousData,
    enabled,
    ...pageOptions,
  });
}

export function useEvent(id: string) {
  return useQuery({ queryKey: eventKeys.detail(id), queryFn: () => eventsApi.get(id) });
}

export function useEventParticipants(id: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: eventKeys.participants(id),
    queryFn: ({ pageParam }) => eventsApi.participants(id, pageParam),
    enabled,
    ...pageOptions,
  });
}

export function useMapEvents(bbox: string | null, enabled: boolean) {
  return useQuery({
    queryKey: eventKeys.map(bbox),
    queryFn: ({ signal }) => eventsApi.map(bbox!, signal),
    enabled: enabled && bbox !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function invalidateEvents(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: eventKeys.all });
}

export function useCreateEvent(communityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: EventBody) => eventsApi.create(communityId, body),
    onSuccess: (event) => {
      queryClient.setQueryData(eventKeys.detail(event.id), event);
      void invalidateEvents(queryClient);
    },
  });
}

export function useUpdateEvent(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<EventBody>) => eventsApi.update(id, body),
    onSuccess: (event) => {
      queryClient.setQueryData(eventKeys.detail(id), event);
      void invalidateEvents(queryClient);
    },
  });
}

export function useDeleteEvent(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => eventsApi.remove(id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: eventKeys.detail(id) });
      void invalidateEvents(queryClient);
      void invalidateChatLists(queryClient);
    },
  });
}

/** RSVP; going / leaving changes the chat list too (the event chat). */
export function useRsvp(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: RsvpStatus | 'none') => eventsApi.rsvp(id, status),
    onSuccess: (event) => {
      queryClient.setQueryData(eventKeys.detail(id), event);
      void queryClient.invalidateQueries({ queryKey: eventKeys.participants(id) });
      void queryClient.invalidateQueries({ queryKey: ['events', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['events', 'map'] });
      void invalidateChatLists(queryClient);
    },
  });
}
