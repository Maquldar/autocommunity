'use client';

import type {
  CreateTopupResult,
  Paginated,
  PremiumDto,
  TopupDto,
  TransferResult,
  WalletDto,
  WalletTransactionDto,
  WalletTxKind,
} from '@autoc/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { queryString } from '@/lib/api/endpoints';
import { ME_QUERY_KEY } from '@/lib/auth/auth-provider';

const { request } = apiClient;
const enc = encodeURIComponent;

export type TransferBody = {
  toUserId?: string;
  toNickname?: string;
  amount: number;
  message?: string;
  idempotencyKey: string;
};

export type DemoCardBody = { cardNumber: string; expiry?: string; cvc?: string };

/** API.md §9.1–9.2. */
export const walletApi = {
  wallet: () => request<WalletDto>('/wallet'),
  transactions: (kind: WalletTxKind | undefined, cursor?: string | null) =>
    request<Paginated<WalletTransactionDto>>(`/wallet/transactions${queryString({ kind, cursor, limit: 20 })}`),
  createTopup: (amount: number) => request<CreateTopupResult>('/wallet/topups', { method: 'POST', json: { amount } }),
  topup: (id: string) => request<TopupDto>(`/wallet/topups/${enc(id)}`),
  demoConfirm: (id: string, body: DemoCardBody) => request<TopupDto>(`/wallet/topups/${enc(id)}/demo-confirm`, { method: 'POST', json: body }),
  transfer: (body: TransferBody) => request<TransferResult>('/wallet/transfers', { method: 'POST', json: body }),
  premium: () => request<PremiumDto>('/premium'),
  subscribe: () => request<PremiumDto>('/premium/subscribe', { method: 'POST' }),
  cancel: () => request<PremiumDto>('/premium/cancel', { method: 'POST' }),
  resume: () => request<PremiumDto>('/premium/resume', { method: 'POST' }),
};

export const walletKeys = {
  all: ['wallet'] as const,
  wallet: ['wallet', 'me'] as const,
  transactionsAll: ['wallet', 'transactions'] as const,
  transactions: (kind: WalletTxKind | undefined) => ['wallet', 'transactions', kind ?? 'all'] as const,
  topup: (id: string) => ['wallet', 'topup', id] as const,
  premium: ['wallet', 'premium'] as const,
};

/** Every wallet/premium read, plus Me (isPremium, tier) — after a transfer, a top-up, a subscription or a push. */
export function invalidateWallet(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: walletKeys.all });
  void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY, exact: true });
}

export function useWallet(enabled = true) {
  return useQuery({ queryKey: walletKeys.wallet, queryFn: walletApi.wallet, enabled });
}

export function useWalletTransactions(kind: WalletTxKind | undefined) {
  return useInfiniteQuery({
    queryKey: walletKeys.transactions(kind),
    queryFn: ({ pageParam }) => walletApi.transactions(kind, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useTopup(id: string) {
  return useQuery({ queryKey: walletKeys.topup(id), queryFn: () => walletApi.topup(id), retry: false });
}

export function useCreateTopup() {
  return useMutation({ mutationFn: (amount: number) => walletApi.createTopup(amount) });
}

export function useDemoConfirm(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DemoCardBody) => walletApi.demoConfirm(id, body),
    onSuccess: (topup) => {
      queryClient.setQueryData(walletKeys.topup(id), topup);
      invalidateWallet(queryClient);
    },
    // A declined card turns the top-up `declined`: re-read it so the page shows the new state.
    onError: () => void queryClient.invalidateQueries({ queryKey: walletKeys.topup(id) }),
  });
}

export function useTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TransferBody) => walletApi.transfer(body),
    onSuccess: (result) => {
      queryClient.setQueryData<WalletDto>(walletKeys.wallet, (w) => (w ? { ...w, balance: result.balance } : w));
      invalidateWallet(queryClient);
    },
  });
}

export function usePremium(enabled = true) {
  return useQuery({ queryKey: walletKeys.premium, queryFn: walletApi.premium, enabled });
}

export function usePremiumAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: 'subscribe' | 'cancel' | 'resume') => walletApi[action](),
    onSuccess: (premium) => {
      queryClient.setQueryData(walletKeys.premium, premium);
      queryClient.setQueryData<WalletDto>(walletKeys.wallet, (w) => (w ? { ...w, premium } : w));
      invalidateWallet(queryClient);
      // The badge shows on every rendering of the user (profile, lists).
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
