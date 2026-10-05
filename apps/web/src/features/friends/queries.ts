'use client';

import type { FriendRequestDto, Paginated, Relation, UserPublic } from '@autoc/shared';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useErrorMessage } from '@/hooks/use-error-message';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/errors';
import { notify } from '@/lib/toast';
import { nextRelation, type FriendAction } from './friend-state';

export const friendsKeys = {
  all: ['friends'] as const,
  list: ['friends', 'list'] as const,
  requests: (direction: 'in' | 'out') => ['friends', 'requests', direction] as const,
};
export const usersSearchKey = (q: string) => ['users', 'search', q] as const;
export const MAP_KEY = ['map'] as const;
export const NOTIFICATIONS_KEY = ['notifications'] as const;

const pageOptions = {
  initialPageParam: null as string | null,
  getNextPageParam: (last: Paginated<unknown>) => last.nextCursor,
};

export function useFriendsList() {
  return useInfiniteQuery({
    queryKey: friendsKeys.list,
    queryFn: ({ pageParam }) => api.friends.list({ cursor: pageParam }),
    ...pageOptions,
  });
}

export function useFriendRequests(direction: 'in' | 'out') {
  return useInfiniteQuery({
    queryKey: friendsKeys.requests(direction),
    queryFn: ({ pageParam }) => api.friends.requests(direction, { cursor: pageParam }),
    ...pageOptions,
  });
}

export function useUserSearch(q: string) {
  const enabled = q.length >= 2;
  return useInfiniteQuery({
    queryKey: usersSearchKey(q),
    queryFn: ({ pageParam, signal }) => api.users.search(q, { cursor: pageParam }, signal),
    enabled,
    ...pageOptions,
  });
}

/**
 * The API addresses requests by id but `UserPublic` only carries `relation`. When the caller doesn't
 * know the id (profile page, map card), it is looked up in the matching request list.
 */
export async function findRequestId(userId: string, direction: 'in' | 'out', maxPages = 10): Promise<string> {
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i += 1) {
    const page: Paginated<FriendRequestDto> = await api.friends.requests(direction, { cursor, limit: 50 });
    const match = page.items.find((request) => request.user.id === userId);
    if (match) return match.id;
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  throw new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Friend request not found' });
}

export type FriendTarget = { id: string; name: string; relation: Relation };
export type FriendActionInput = { user: FriendTarget; action: FriendAction; requestId?: string };

export async function runFriendAction({ user, action, requestId }: FriendActionInput): Promise<void> {
  switch (action) {
    case 'add':
      await api.friends.send(user.id);
      return;
    case 'accept':
      // Without the id, sending a request back auto-accepts the pending one (API.md §2).
      if (requestId) await api.friends.accept(requestId);
      else await api.friends.send(user.id);
      return;
    case 'decline':
      await api.friends.decline(requestId ?? (await findRequestId(user.id, 'in')));
      return;
    case 'cancel':
      await api.friends.cancel(requestId ?? (await findRequestId(user.id, 'out')));
      return;
    case 'unfriend':
      await api.friends.remove(user.id);
      return;
  }
}

type Snapshot = Array<[QueryKey, unknown]>;

function mapPages<T>(data: InfiniteData<Paginated<T>> | undefined, fn: (items: T[]) => T[]): InfiniteData<Paginated<T>> | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, items: fn(page.items) })) };
}

/** Applies the expected result of an action to every cached copy of the user; returns what to restore. */
export function applyOptimisticFriendAction(queryClient: QueryClient, { user, action, requestId }: FriendActionInput): Snapshot {
  const next = nextRelation(user.relation, action);
  const snapshot: Snapshot = [];
  const remember = (key: QueryKey) => {
    for (const entry of queryClient.getQueriesData({ queryKey: key })) snapshot.push(entry);
  };
  remember(['users', user.id]);
  remember(['users', 'search']);
  remember(friendsKeys.all);

  if (next) {
    queryClient.setQueryData<UserPublic>(['users', user.id], (current) => (current ? { ...current, relation: next } : current));
    queryClient.setQueriesData<InfiniteData<Paginated<UserPublic>>>({ queryKey: ['users', 'search'] }, (data) =>
      mapPages(data, (items) => items.map((item) => (item.id === user.id ? { ...item, relation: next } : item))),
    );
  }
  const dropRequest = (direction: 'in' | 'out') =>
    queryClient.setQueryData<InfiniteData<Paginated<FriendRequestDto>>>(friendsKeys.requests(direction), (data) =>
      mapPages(data, (items) => items.filter((r) => r.user.id !== user.id && r.id !== requestId)),
    );
  if (action === 'unfriend') {
    queryClient.setQueryData<InfiniteData<Paginated<UserPublic>>>(friendsKeys.list, (data) =>
      mapPages(data, (items) => items.filter((item) => item.id !== user.id)),
    );
  }
  if (action === 'accept' || action === 'decline') dropRequest('in');
  if (action === 'cancel') dropRequest('out');
  return snapshot;
}

export function invalidateFriendData(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: friendsKeys.all }),
    queryClient.invalidateQueries({ queryKey: ['users'] }),
    queryClient.invalidateQueries({ queryKey: MAP_KEY }),
  ]);
}

/** Every friend action with optimistic cache updates, rollback on error and a toast. */
export function useFriendAction() {
  const queryClient = useQueryClient();
  const t = useTranslations('friends.toasts');
  const errorMessage = useErrorMessage();

  return useMutation({
    mutationFn: runFriendAction,
    onMutate: async (input) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['users'] }),
        queryClient.cancelQueries({ queryKey: friendsKeys.all }),
      ]);
      return { snapshot: applyOptimisticFriendAction(queryClient, input) };
    },
    onError: (error, _input, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data);
      notify.error(errorMessage(error));
    },
    onSuccess: (_data, { user, action }) => {
      const name = user.name;
      if (action === 'add') notify.success(user.relation === 'request_in' ? t('accepted', { name }) : t('sent', { name }));
      else if (action === 'accept') notify.success(t('accepted', { name }));
      else if (action === 'decline') notify.success(t('declined'));
      else if (action === 'cancel') notify.success(t('cancelled'));
      else notify.success(t('removed', { name }));
    },
    onSettled: () => {
      void invalidateFriendData(queryClient);
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    },
  });
}
