import type { NotificationDto } from '@autoc/shared';
import type { QueryClient } from '@tanstack/react-query';
import { cacheChatRead, cacheDeletedMessage, cacheIncomingMessage, invalidateChatLists } from '@/features/chats/cache';
import { readStore, typingStore } from '@/features/chats/live-stores';
import { communityKeys } from '@/features/communities/keys';
import { invalidateFriendData } from '@/features/friends/queries';
import { notificationKeys, prependNotification, setUnreadCount } from '@/features/notifications/queries';
import { alertFromNotification, alertFromSos, sosAlertStore } from '@/features/sos/alerts';
import { applySosToCache, sosKeys } from '@/features/sos/cache';
import { isSosOpen } from '@/features/sos/view-model';
import { voteKeys } from '@/features/votes/api';
import { violationKeys } from '@/features/violations/api';
import { invalidateWallet } from '@/features/wallet/api';
import type { RealtimeHandlers } from './client';

export type AppHandlerDeps = {
  queryClient: QueryClient;
  /** Shows the in-app toast for a live notification. */
  toast: (notification: NotificationDto) => void;
  /** Ends the local session (server revoked it: logout-all, block, refresh reuse). */
  logout: () => void;
  /** The signed-in user's id (own messages never count as unread). */
  getMyId?: () => string | null;
  /** Urgent SOS alerts (defaults to the app-wide store). */
  alerts?: Pick<typeof sosAlertStore, 'push' | 'remove'>;
};

const FRIEND_TYPES = new Set(['friend_request', 'friend_accepted']);
const COMMUNITY_TYPES = new Set(['community_request', 'community_approved', 'community_role']);
const SOS_TYPES = new Set(['sos_nearby', 'sos_response', 'sos_accepted', 'sos_status']);
const EVENT_TYPES = new Set(['event_new', 'event_reminder']);
const POST_TYPES = new Set(['post_comment', 'post_like']);
/* phase 9: coins and premium change the wallet (and Me.isPremium); votes and violations move the rating. */
const WALLET_TYPES = new Set(['wallet_received', 'wallet_admin', 'premium_reminder', 'premium_renewed', 'premium_expired', 'purchase_paid']);
const VIOLATION_TYPES = new Set(['violation_reported', 'violation_status']);

/** What the app does with each server event. Pure wiring over the query cache, unit-tested with a fake socket. */
export function createAppRealtimeHandlers({
  queryClient,
  toast,
  logout,
  getMyId = () => null,
  alerts = sosAlertStore,
}: AppHandlerDeps): RealtimeHandlers {
  return {
    onNotification: (notification) => {
      prependNotification(queryClient, notification);
      void queryClient.invalidateQueries({ queryKey: notificationKeys.unread });
      if (FRIEND_TYPES.has(notification.type)) void invalidateFriendData(queryClient);
      // Requests, approvals and role changes change memberships, member lists and moderator rights.
      if (COMMUNITY_TYPES.has(notification.type)) void queryClient.invalidateQueries({ queryKey: communityKeys.all });
      if (SOS_TYPES.has(notification.type)) void queryClient.invalidateQueries({ queryKey: sosKeys.active });
      if (notification.type === 'review_received') {
        void queryClient.invalidateQueries({ queryKey: ['rating'] });
        void queryClient.invalidateQueries({ queryKey: ['reviews'] });
        void queryClient.invalidateQueries({ queryKey: ['me'], exact: true });
      }
      // New / changed / cancelled events and new comments or likes on the viewer's posts.
      if (EVENT_TYPES.has(notification.type)) void queryClient.invalidateQueries({ queryKey: ['events'] });
      if (POST_TYPES.has(notification.type)) void queryClient.invalidateQueries({ queryKey: ['feed'] });
      if (WALLET_TYPES.has(notification.type)) invalidateWallet(queryClient);
      if (notification.type === 'vote_received') {
        void queryClient.invalidateQueries({ queryKey: voteKeys.all });
        void queryClient.invalidateQueries({ queryKey: ['rating'] });
        void queryClient.invalidateQueries({ queryKey: ['me'], exact: true });
      }
      if (VIOLATION_TYPES.has(notification.type)) {
        void queryClient.invalidateQueries({ queryKey: violationKeys.all });
        void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
        void queryClient.invalidateQueries({ queryKey: ['rating'] });
        void queryClient.invalidateQueries({ queryKey: ['me'], exact: true });
      }
      // "Someone nearby needs help" gets the urgent SOS banner instead of an ordinary toast.
      const alert = alertFromNotification(notification);
      if (alert) alerts.push(alert);
      // The buyer is already looking at the receipt (phase 10): the notification only lands in the list.
      else if (notification.type !== 'purchase_paid') toast(notification);
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
    onSosNew: (sos) => {
      applySosToCache(queryClient, sos, 'new');
      if (isSosOpen(sos.status) && sos.myRole !== 'requester') alerts.push(alertFromSos(sos));
    },
    onSosUpdate: (sos) => {
      applySosToCache(queryClient, sos, 'update');
      // Once it is accepted by others or over, the "needs help" banner is stale.
      if (!isSosOpen(sos.status) || sos.status === 'in_progress') alerts.remove(sos.id);
    },
  };
}
