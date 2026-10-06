'use client';

import type {
  AdminActionDto,
  AdminCommunityDto,
  AdminReportDto,
  AdminResolveResult,
  AdminServiceDto,
  AdminServiceQrDto,
  AdminSosDetail,
  AdminSosRow,
  AdminStatsDto,
  AdminUserDetail,
  AdminUserRow,
  AdminUserStatus,
  AdminVisitDto,
  FraudFlagDto,
  FraudFlagKind,
  Paginated,
  ReportStatus,
  ReportTargetType,
  ServiceStatus,
  SosStatus,
} from '@autoc/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { queryString } from '@/lib/api/endpoints';

const { request } = apiClient;
const enc = encodeURIComponent;

export type UsersFilter = { q?: string; status?: AdminUserStatus };
export type ReportsFilter = { status?: ReportStatus; targetType?: ReportTargetType };
export type SosFilter = { status?: SosStatus };
export type ServicesFilter = { status?: ServiceStatus; q?: string };
export type CommunitiesFilter = { q?: string };
export type FlagsFilter = { kind?: FraudFlagKind; userId?: string };
export type AuditFilter = { adminId?: string; targetUserId?: string };

type Page = { cursor?: string | null };
const page = (p: Page) => ({ cursor: p.cursor ?? undefined, limit: 25 });

/** API.md §6 — kept inside the admin feature so other phases can grow `lib/api/endpoints.ts` independently. */
export const adminApi = {
  stats: () => request<AdminStatsDto>('/admin/stats'),
  users: (f: UsersFilter & Page) => request<Paginated<AdminUserRow>>(`/admin/users${queryString({ q: f.q, status: f.status, ...page(f) })}`),
  user: (id: string) => request<AdminUserDetail>(`/admin/users/${enc(id)}`),
  warn: (id: string, note: string) => request<AdminUserDetail>(`/admin/users/${enc(id)}/warn`, { method: 'POST', json: { note } }),
  block: (id: string, note: string, until: string | null) =>
    request<AdminUserDetail>(`/admin/users/${enc(id)}/block`, { method: 'POST', json: until ? { note, until } : { note } }),
  unblock: (id: string, note: string) => request<AdminUserDetail>(`/admin/users/${enc(id)}/unblock`, { method: 'POST', json: { note } }),
  sosBan: (id: string, note: string, until: string) =>
    request<AdminUserDetail>(`/admin/users/${enc(id)}/sos-ban`, { method: 'POST', json: { note, until } }),
  sosUnban: (id: string, note: string) => request<AdminUserDetail>(`/admin/users/${enc(id)}/sos-unban`, { method: 'POST', json: { note } }),
  communities: (f: CommunitiesFilter & Page) => request<Paginated<AdminCommunityDto>>(`/admin/communities${queryString({ q: f.q, ...page(f) })}`),
  deleteCommunity: (id: string, note: string) => request<void>(`/admin/communities/${enc(id)}`, { method: 'DELETE', json: { note } }),
  sosList: (f: SosFilter & Page) => request<Paginated<AdminSosRow>>(`/admin/sos${queryString({ status: f.status, ...page(f) })}`),
  sos: (id: string) => request<AdminSosDetail>(`/admin/sos/${enc(id)}`),
  markFake: (id: string, note: string) => request<AdminSosDetail>(`/admin/sos/${enc(id)}/mark-fake`, { method: 'POST', json: { note } }),
  reports: (f: ReportsFilter & Page) =>
    request<Paginated<AdminReportDto>>(`/admin/reports${queryString({ status: f.status, targetType: f.targetType, ...page(f) })}`),
  resolve: (id: string, body: { decision: 'confirm' | 'dismiss'; note: string; removeContent: boolean }) =>
    request<AdminResolveResult>(`/admin/reports/${enc(id)}/resolve`, { method: 'POST', json: body }),
  flags: (f: FlagsFilter & Page) => request<Paginated<FraudFlagDto>>(`/admin/fraud-flags${queryString({ kind: f.kind, userId: f.userId, ...page(f) })}`),
  audit: (f: AuditFilter & Page) =>
    request<Paginated<AdminActionDto>>(`/admin/audit${queryString({ adminId: f.adminId, targetUserId: f.targetUserId, ...page(f) })}`),
  services: (f: ServicesFilter & Page) => request<Paginated<AdminServiceDto>>(`/admin/services${queryString({ status: f.status, q: f.q, ...page(f) })}`),
  setServiceStatus: (id: string, action: 'verify' | 'reject', note: string) =>
    request<AdminServiceDto>(`/admin/services/${enc(id)}/${action}`, { method: 'POST', json: { note } }),
  serviceQr: (id: string) => request<AdminServiceQrDto>(`/admin/services/${enc(id)}/qr`),
  visits: (f: Page) => request<Paginated<AdminVisitDto>>(`/admin/visits${queryString({ status: 'pending', ...page(f) })}`),
  setVisitStatus: (id: string, action: 'approve' | 'reject', note: string) =>
    request<AdminVisitDto>(`/admin/visits/${enc(id)}/${action}`, { method: 'POST', json: { note } }),
};

export const adminKeys = {
  all: ['admin'] as const,
  stats: ['admin', 'stats'] as const,
  users: (f: UsersFilter) => ['admin', 'users', f] as const,
  user: (id: string) => ['admin', 'user', id] as const,
  communities: (f: CommunitiesFilter) => ['admin', 'communities', f] as const,
  sosList: (f: SosFilter) => ['admin', 'sos', f] as const,
  sos: (id: string) => ['admin', 'sos-detail', id] as const,
  reports: (f: ReportsFilter) => ['admin', 'reports', f] as const,
  flags: (f: FlagsFilter) => ['admin', 'flags', f] as const,
  audit: (f: AuditFilter) => ['admin', 'audit', f] as const,
  services: (f: ServicesFilter) => ['admin', 'services', f] as const,
  qr: (id: string) => ['admin', 'qr', id] as const,
  visits: ['admin', 'visits'] as const,
};

const pageOptions = {
  initialPageParam: null as string | null,
  getNextPageParam: (last: Paginated<unknown>) => last.nextCursor,
};

export const useAdminStats = () => useQuery({ queryKey: adminKeys.stats, queryFn: adminApi.stats });
export const useAdminUser = (id: string) => useQuery({ queryKey: adminKeys.user(id), queryFn: () => adminApi.user(id) });
export const useAdminSos = (id: string) => useQuery({ queryKey: adminKeys.sos(id), queryFn: () => adminApi.sos(id) });
export const useServiceQr = (id: string, enabled: boolean) =>
  useQuery({ queryKey: adminKeys.qr(id), queryFn: () => adminApi.serviceQr(id), enabled, staleTime: 10 * 60_000 });

export const useAdminUsers = (f: UsersFilter) =>
  useInfiniteQuery({ queryKey: adminKeys.users(f), queryFn: ({ pageParam }) => adminApi.users({ ...f, cursor: pageParam }), ...pageOptions });
export const useAdminCommunities = (f: CommunitiesFilter) =>
  useInfiniteQuery({ queryKey: adminKeys.communities(f), queryFn: ({ pageParam }) => adminApi.communities({ ...f, cursor: pageParam }), ...pageOptions });
export const useAdminSosList = (f: SosFilter) =>
  useInfiniteQuery({ queryKey: adminKeys.sosList(f), queryFn: ({ pageParam }) => adminApi.sosList({ ...f, cursor: pageParam }), ...pageOptions });
export const useAdminReports = (f: ReportsFilter) =>
  useInfiniteQuery({ queryKey: adminKeys.reports(f), queryFn: ({ pageParam }) => adminApi.reports({ ...f, cursor: pageParam }), ...pageOptions });
export const useAdminFlags = (f: FlagsFilter) =>
  useInfiniteQuery({ queryKey: adminKeys.flags(f), queryFn: ({ pageParam }) => adminApi.flags({ ...f, cursor: pageParam }), ...pageOptions });
export const useAdminAudit = (f: AuditFilter) =>
  useInfiniteQuery({ queryKey: adminKeys.audit(f), queryFn: ({ pageParam }) => adminApi.audit({ ...f, cursor: pageParam }), ...pageOptions });
export const useAdminServices = (f: ServicesFilter) =>
  useInfiniteQuery({ queryKey: adminKeys.services(f), queryFn: ({ pageParam }) => adminApi.services({ ...f, cursor: pageParam }), ...pageOptions });
export const useAdminVisits = () =>
  useInfiniteQuery({ queryKey: adminKeys.visits, queryFn: ({ pageParam }) => adminApi.visits({ cursor: pageParam }), ...pageOptions });

/** Any admin mutation: refreshes every admin query afterwards (lists, counters, the audit log). */
export function useAdminMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
  });
}
