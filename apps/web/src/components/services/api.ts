'use client';

import type {
  CreateServiceInput,
  CreateServiceReviewInput,
  CreateVisitInput,
  Paginated,
  ServiceCategory,
  ServiceDto,
  ServiceListItem,
  ServiceMapResult,
  ServiceReviewDto,
  VisitDto,
} from '@autoc/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

const { request } = apiClient;

type Coords = { lat: number; lng: number };

export type ServiceListParams = {
  category?: ServiceCategory;
  q?: string;
  sort: 'distance' | 'rating';
  /** Rounded to ~100 m by the caller so small GPS jitter doesn't refetch. */
  at?: Coords | null;
};

function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  const s = search.toString();
  return s ? `?${s}` : '';
}

const enc = encodeURIComponent;

/** API.md §7 endpoints. Kept in the services feature so Phase 2 can grow `lib/api/endpoints.ts` independently. */
export const servicesApi = {
  list: (p: ServiceListParams, cursor?: string | null) =>
    request<Paginated<ServiceListItem>>(
      `/services${qs({ category: p.category, q: p.q, sort: p.sort, lat: p.at?.lat, lng: p.at?.lng, cursor, limit: 20 })}`,
    ),
  map: (bbox: [number, number, number, number], category?: ServiceCategory, signal?: AbortSignal) =>
    request<ServiceMapResult>(`/map/services${qs({ bbox: bbox.join(','), category })}`, { signal }),
  get: (id: string, at?: Coords | null) => request<ServiceDto>(`/services/${enc(id)}${qs({ lat: at?.lat, lng: at?.lng })}`),
  create: (input: CreateServiceInput) => request<ServiceDto>('/services', { method: 'POST', json: input }),
  reviews: (id: string, cursor?: string | null) =>
    request<Paginated<ServiceReviewDto>>(`/services/${enc(id)}/reviews${qs({ cursor, limit: 10 })}`),
  createReview: (id: string, input: CreateServiceReviewInput) =>
    request<ServiceReviewDto>(`/services/${enc(id)}/reviews`, { method: 'POST', json: input }),
  createVisit: (id: string, input: CreateVisitInput) =>
    request<VisitDto>(`/services/${enc(id)}/visits`, { method: 'POST', json: input }),
};

export const SERVICES_KEY = ['services'] as const;
export const serviceListKey = (p: ServiceListParams) => ['services', 'list', p] as const;
export const serviceKey = (id: string) => ['services', 'detail', id] as const;
export const serviceReviewsKey = (id: string) => ['services', 'reviews', id] as const;

/** ~100 m grid so the query key only changes when the user actually moves. */
export const roundCoords = (c: Coords | null | undefined): Coords | null =>
  c ? { lat: Math.round(c.lat * 1000) / 1000, lng: Math.round(c.lng * 1000) / 1000 } : null;

export function useServiceList(params: ServiceListParams) {
  return useInfiniteQuery({
    queryKey: serviceListKey(params),
    queryFn: ({ pageParam }) => servicesApi.list(params, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

export function useService(id: string, at: Coords | null) {
  return useQuery({ queryKey: [...serviceKey(id), at], queryFn: () => servicesApi.get(id, at), placeholderData: keepPreviousData });
}

export function useServiceReviews(id: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: serviceReviewsKey(id),
    queryFn: ({ pageParam }) => servicesApi.reviews(id, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** A visit or review changes the service (myVisit, counters, rating), its reviews and list ordering. */
function useInvalidateServices() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: SERVICES_KEY });
}

export function useCreateVisit(serviceId: string) {
  const invalidate = useInvalidateServices();
  return useMutation({ mutationFn: (input: CreateVisitInput) => servicesApi.createVisit(serviceId, input), onSuccess: invalidate });
}

export function useCreateReview(serviceId: string) {
  const invalidate = useInvalidateServices();
  return useMutation({
    mutationFn: (input: CreateServiceReviewInput) => servicesApi.createReview(serviceId, input),
    onSuccess: invalidate,
  });
}

export function useCreateService() {
  const invalidate = useInvalidateServices();
  return useMutation({ mutationFn: (input: CreateServiceInput) => servicesApi.create(input), onSuccess: invalidate });
}
