import type { NotificationDto } from '@autoc/shared';
import type { QueryClient } from '@tanstack/react-query';
import { cacheChatRead, cacheDeletedMessage, cacheIncomingMessage, invalidateChatLists } from '@/features/chats/cache';
import { readStore, typingStore } from '@/features/chats/live-stores';
import { communityKeys } from '@/features/communities/keys';
import { invalidateFriendData } from '@/features/friends/queries';
import { notificationKeys, prependNotification, setUnreadCount } from '@/features/notifications/queries';
import type { RealtimeHandlers } from './client';

export type AppHandlerDeps = {
  queryClient: QueryClient;
  /** Shows the in-app toast for a live notification. */
  toast: (notification: NotificationDto) => void;
  /** Ends the local session (server revoked it: logout-all, block, refresh reuse). */
  logout: () => void;
  /** The signed-in user's id (own messages never count as unread). */
  getMyId?: () => string | null;
};

const FRIEND_TYPES = new Set(['friend_request', 'friend_accepted']);
const COMMUNITY_TYPES = new Set(['community_request', 'community_approved', 'community_role']);
const EVENT_TYPES = new Set(['event_new', 'event_reminder']);
const POST_TYPES = new Set(['post_comment', 'post_like']);

/** What the app does with each server event. Pure wiring over the query cache, unit-tested with a fake socket. */
export function createAppRealtimeHandlers({ queryClient, toast, logout, getMyId = () => null }: AppHandlerDeps): RealtimeHandlers {
  return {
    onNotification: (notification) => {
      prependNotification(queryClient, notification);
      void queryClient.invalidateQueries({ queryKey: notificationKeys.unread });
      if (FRIEND_TYPES.has(notification.type)) void invalidateFriendData(queryClient);
      // Requests, approvals and role changes change memberships, member lists and moderator rights.
      if (COMMUNITY_TYPES.has(notification.type)) void queryClient.invalidateQueries({ queryKey: communityKeys.all });
      // New / changed / cancelled events and new comments or likes on the viewer's posts.
      if (EVENT_TYPES.has(notification.type)) void queryClient.invalidateQueries({ queryKey: ['events'] });
      if (POST_TYPES.has(notification.type)) void queryClient.invalidateQueries({ queryKey: ['feed'] });
      toast(notification);
    },
    onCount: (count) => setUnreadCount(queryClient, count),
    onFriendsChanged: () => void invalidateFriendData(queryClient),
    onRevoked: () => logout(),
    onMessage: (message) => {
      typingStore.remove(message.chatId, message.sender.id);
      cacheIncomingMessage(queryClient, message, getMyId());
    },
    onMessageDeleted: ({ chatId, messageId }) => cacheDeletedMessage(queryClient, chatId, messageId),
    onTyping: ({ chatId, user }) => {
      if (user.id !== getMyId()) typingStore.add(chatId, user);
    },
    onRead: ({ chatId, userId, lastReadAt }) => {
      // Our own read (another tab or device) clears the badge; others' reads drive read receipts.
      if (userId === getMyId()) cacheChatRead(queryClient, chatId);
      else readStore.set(chatId, userId, lastReadAt);
    },
    onChatsChanged: () => {
      void invalidateChatLists(queryClient);
      void queryClient.invalidateQueries({ queryKey: communityKeys.all });
    },
  };
}
