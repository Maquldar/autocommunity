'use client';

import type { ChatDto, Paginated } from '@autoc/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useErrorMessage } from '@/hooks/use-error-message';
import { api } from '@/lib/api';
import { notify } from '@/lib/toast';
import { cacheChatRead, cacheDeletedMessage, chatKeys, invalidateChatLists, unreadTotal } from './cache';

/** Chats per page; one page usually holds every chat, which keeps the nav badge exact. */
export const CHATS_PAGE_SIZE = 50;
/** Messages per history page. */
export const MESSAGES_PAGE_SIZE = 30;

const pageOptions = {
  initialPageParam: null as string | null,
  getNextPageParam: (last: Paginated<unknown>) => last.nextCursor,
};

export function useChats(enabled = true) {
  return useInfiniteQuery({
    queryKey: chatKeys.list,
    queryFn: ({ pageParam }) => api.chats.list({ cursor: pageParam, limit: CHATS_PAGE_SIZE }),
    enabled,
    // Live updates come over the socket; this is the fallback when it can't connect.
    refetchInterval: 60_000,
    ...pageOptions,
  });
}

/** Total unread messages over the loaded chat list (bottom-bar / sidebar badge). */
export function useUnreadChatsTotal(enabled: boolean): number {
  const chats = useChats(enabled);
  return unreadTotal(chats.data);
}

export function useChat(id: string) {
  return useQuery({ queryKey: chatKeys.detail(id), queryFn: () => api.chats.get(id) });
}

/** History, newest page first (keyset cursor); the view renders it oldest-first. */
export function useChatMessages(id: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: chatKeys.messages(id),
    queryFn: ({ pageParam }) => api.chats.messages(id, { cursor: pageParam, limit: MESSAGES_PAGE_SIZE }),
    enabled,
    // The socket keeps an open conversation current; don't refetch every page on focus.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    ...pageOptions,
  });
}

/** POST /chats/direct (get or create), then open the conversation. */
export function useOpenDirectChat() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (userId: string) => api.chats.direct(userId),
    onSuccess: (chat: ChatDto) => {
      queryClient.setQueryData(chatKeys.detail(chat.id), chat);
      void invalidateChatLists(queryClient);
      router.push(`/chats/${chat.id}`);
    },
    onError: (error) => notify.error(errorMessage(error)),
  });
}

export function useDeleteMessage(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => api.chats.deleteMessage(chatId, messageId),
    onSuccess: (_data, messageId) => cacheDeletedMessage(queryClient, chatId, messageId),
  });
}

export function useMarkChatRead(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.chats.read(chatId),
    onMutate: () => cacheChatRead(queryClient, chatId),
  });
}
