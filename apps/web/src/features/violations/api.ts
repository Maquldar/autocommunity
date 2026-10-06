'use client';

import type { CreateViolationInput, Paginated, ViolationDto } from '@autoc/shared';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { queryString } from '@/lib/api/endpoints';

const { request } = apiClient;
const enc = encodeURIComponent;

/** Wire body of POST /vehicles/:id/violations (`occurredAt` as an ISO string). */
export type CreateViolationBody = Omit<CreateViolationInput, 'occurredAt' | 'article'> & { occurredAt: string; article?: string };

/** API.md §9.4. */
export const violationsApi = {
  forVehicle: (vehicleId: string, cursor?: string | null) =>
    request<Paginated<ViolationDto>>(`/vehicles/${enc(vehicleId)}/violations${queryString({ cursor, limit: 20 })}`),
  forUser: (userId: string, cursor?: string | null) => request<Paginated<ViolationDto>>(`/users/${enc(userId)}/violations${queryString({ cursor, limit: 20 })}`),
  submitted: (cursor?: string | null) => request<Paginated<ViolationDto>>(`/me/violations/submitted${queryString({ cursor, limit: 20 })}`),
  create: (vehicleId: string, body: CreateViolationBody) => request<ViolationDto>(`/vehicles/${enc(vehicleId)}/violations`, { method: 'POST', json: body }),
  dispute: (id: string, text: string) => request<ViolationDto>(`/violations/${enc(id)}/dispute`, { method: 'POST', json: { text } }),
};

export const violationKeys = {
  all: ['violations'] as const,
  vehicle: (vehicleId: string) => ['violations', 'vehicle', vehicleId] as const,
  user: (userId: string) => ['violations', 'user', userId] as const,
  submitted: ['violations', 'submitted'] as const,
};

const pageOptions = {
  initialPageParam: null as string | null,
  getNextPageParam: (last: Paginated<unknown>) => last.nextCursor,
};

export function useVehicleViolations(vehicleId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: violationKeys.vehicle(vehicleId),
    queryFn: ({ pageParam }) => violationsApi.forVehicle(vehicleId, pageParam),
    enabled,
    ...pageOptions,
  });
}

export function useSubmittedViolations() {
  return useInfiniteQuery({ queryKey: violationKeys.submitted, queryFn: ({ pageParam }) => violationsApi.submitted(pageParam), ...pageOptions });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: violationKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
  };
}

export function useCreateViolation(vehicleId: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body: CreateViolationBody) => violationsApi.create(vehicleId, body), onSuccess: invalidate });
}

export function useDisputeViolation() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: ({ id, text }: { id: string; text: string }) => violationsApi.dispute(id, text), onSuccess: invalidate });
}
