'use client';

import type { AdminPayPartnerInput, CreatePayOrderInput, Paginated, PayItemInput, PayPointDto, PayPointManageDto, PayReceiptDto, WalletDto } from '@autoc/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { queryString } from '@/lib/api/endpoints';
import { invalidateWallet, walletKeys } from '@/features/wallet/api';

const { request } = apiClient;
const enc = encodeURIComponent;

/** API.md §11. */
export const payApi = {
  point: (serviceId: string) => request<PayPointDto>(`/pay/points/${enc(serviceId)}`),
  byTag: (tag: string) => request<PayPointDto>(`/pay/t/${enc(tag)}`),
  manage: (serviceId: string) => request<PayPointManageDto>(`/pay/points/${enc(serviceId)}/manage`),
  putItems: (serviceId: string, body: { items: PayItemInput[]; note?: string }) =>
    request<PayPointManageDto>(`/pay/points/${enc(serviceId)}/items`, { method: 'PUT', json: body }),
  partner: (serviceId: string, body: AdminPayPartnerInput) => request<PayPointManageDto>(`/admin/services/${enc(serviceId)}/partner`, { method: 'PUT', json: body }),
  rotate: (serviceId: string, note: string) => request<PayPointManageDto>(`/admin/services/${enc(serviceId)}/pay-tag/rotate`, { method: 'POST', json: { note } }),
  createOrder: (body: CreatePayOrderInput) => request<PayReceiptDto>('/pay/orders', { method: 'POST', json: body }),
  orders: (cursor?: string | null) => request<Paginated<PayReceiptDto>>(`/pay/orders${queryString({ cursor, limit: 20 })}`),
  order: (id: string) => request<PayReceiptDto>(`/pay/orders/${enc(id)}`),
};

export const payKeys = {
  all: ['pay'] as const,
  point: (by: 'id' | 'tag', key: string) => ['pay', 'point', by, key] as const,
  manage: (serviceId: string) => ['pay', 'manage', serviceId] as const,
  orders: ['pay', 'orders'] as const,
  order: (id: string) => ['pay', 'order', id] as const,
};

export function usePayPoint(by: 'id' | 'tag', key: string) {
  return useQuery({
    queryKey: payKeys.point(by, key),
    queryFn: () => (by === 'tag' ? payApi.byTag(key) : payApi.point(key)),
    enabled: key.length > 0,
    retry: false,
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePayOrderInput) => payApi.createOrder(body),
    onSuccess: (receipt) => {
      queryClient.setQueryData(payKeys.order(receipt.orderId), receipt);
      if (receipt.balanceAfter !== null) queryClient.setQueryData<WalletDto>(walletKeys.wallet, (w) => (w ? { ...w, balance: receipt.balanceAfter! } : w));
      void queryClient.invalidateQueries({ queryKey: payKeys.orders });
      invalidateWallet(queryClient);
    },
  });
}

export function usePayOrder(id: string) {
  return useQuery({ queryKey: payKeys.order(id), queryFn: () => payApi.order(id), retry: false });
}

export function usePayOrders() {
  return useInfiniteQuery({
    queryKey: payKeys.orders,
    queryFn: ({ pageParam }) => payApi.orders(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function usePayManage(serviceId: string, enabled: boolean) {
  return useQuery({ queryKey: payKeys.manage(serviceId), queryFn: () => payApi.manage(serviceId), enabled });
}

/** Writes from the partner panel: refresh the panel, the public point and the service card. */
export function usePayManageMutation<T>(serviceId: string, fn: (input: T) => Promise<PayPointManageDto>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (dto) => {
      queryClient.setQueryData(payKeys.manage(serviceId), dto);
      void queryClient.invalidateQueries({ queryKey: ['pay', 'point'] });
      void queryClient.invalidateQueries({ queryKey: ['services'] });
    },
  });
}
