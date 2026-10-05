'use client';

import type { NotificationDto, Paginated } from '@autoc/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread-count'] as const,
};

type ListData = InfiniteData<Paginated<NotificationDto>, string | null>;

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: notificationKeys.list,
    queryFn: ({ pageParam }) => api.notifications.list({ cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn: api.notifications.unreadCount,
    enabled,
    // The socket pushes `notification:count`; this is the fallback when it can't connect.
    refetchInterval: 60_000,
  });
}

function mapItems(data: ListData | undefined, fn: (n: NotificationDto) => NotificationDto): ListData | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map(fn) })) };
}

/** Adds a live notification to the top of the cached list (no duplicates). */
export function prependNotification(queryClient: QueryClient, notification: NotificationDto) {
  queryClient.setQueryData<ListData>(notificationKeys.list, (data) => {
    if (!data || data.pages.length === 0) return data;
    const exists = data.pages.some((page) => page.items.some((item) => item.id === notification.id));
    if (exists) return data;
    const [first, ...rest] = data.pages;
    return { ...data, pages: [{ ...first!, items: [notification, ...first!.items] }, ...rest] };
  });
}

export function setUnreadCount(queryClient: QueryClient, count: number) {
  queryClient.setQueryData<{ count: number }>(notificationKeys.unread, { count: Math.max(0, count) });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notification: Pick<NotificationDto, 'id'>) => api.notifications.read(notification.id),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all });
      const list = queryClient.getQueryData<ListData>(notificationKeys.list);
      const count = queryClient.getQueryData<{ count: number }>(notificationKeys.unread);
      const wasUnread = list?.pages.some((page) => page.items.some((n) => n.id === id && n.readAt === null)) ?? true;
      const now = new Date().toISOString();
      queryClient.setQueryData<ListData>(notificationKeys.list, (data) => mapItems(data, (n) => (n.id === id && !n.readAt ? { ...n, readAt: now } : n)));
      if (count && wasUnread) setUnreadCount(queryClient, count.count - 1);
      return { list, count };
    },
    onError: (_error, _input, context) => {
      if (context?.list) queryClient.setQueryData(notificationKeys.list, context.list);
      if (context?.count) queryClient.setQueryData(notificationKeys.unread, context.count);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.unread }),
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.notifications.readAll(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all });
      const list = queryClient.getQueryData<ListData>(notificationKeys.list);
      const count = queryClient.getQueryData<{ count: number }>(notificationKeys.unread);
      const now = new Date().toISOString();
      queryClient.setQueryData<ListData>(notificationKeys.list, (data) => mapItems(data, (n) => (n.readAt ? n : { ...n, readAt: now })));
      setUnreadCount(queryClient, 0);
      return { list, count };
    },
    onError: (_error, _input, context) => {
      if (context?.list) queryClient.setQueryData(notificationKeys.list, context.list);
      if (context?.count) queryClient.setQueryData(notificationKeys.unread, context.count);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
