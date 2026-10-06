'use client';

import type { CreateReportInput, Paginated, ReportDto } from '@autoc/shared';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { queryString } from '@/lib/api/endpoints';

const { request } = apiClient;

export const reportKeys = { mine: ['reports', 'mine'] as const };

export const reportsApi = {
  create: (input: CreateReportInput) => request<ReportDto>('/reports', { method: 'POST', json: input }),
  mine: (cursor?: string | null) => request<Paginated<ReportDto>>(`/me/reports${queryString({ cursor, limit: 20 })}`),
};

export function useCreateReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reportsApi.create,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: reportKeys.mine }),
  });
}

export function useMyReports() {
  return useInfiniteQuery({
    queryKey: reportKeys.mine,
    queryFn: ({ pageParam }) => reportsApi.mine(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}
