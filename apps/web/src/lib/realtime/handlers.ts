import type { NotificationDto } from '@autoc/shared';
import type { QueryClient } from '@tanstack/react-query';
import { invalidateFriendData } from '@/features/friends/queries';
import { notificationKeys, prependNotification, setUnreadCount } from '@/features/notifications/queries';
import type { RealtimeHandlers } from './client';

export type AppHandlerDeps = {
  queryClient: QueryClient;
  /** Shows the in-app toast for a live notification. */
  toast: (notification: NotificationDto) => void;
  /** Ends the local session (server revoked it: logout-all, block, refresh reuse). */
  logout: () => void;
};

const FRIEND_TYPES = new Set(['friend_request', 'friend_accepted']);

/** What the app does with each server event. Pure wiring over the query cache, unit-tested with a fake socket. */
export function createAppRealtimeHandlers({ queryClient, toast, logout }: AppHandlerDeps): RealtimeHandlers {
  return {
    onNotification: (notification) => {
      prependNotification(queryClient, notification);
      void queryClient.invalidateQueries({ queryKey: notificationKeys.unread });
      if (FRIEND_TYPES.has(notification.type)) void invalidateFriendData(queryClient);
      toast(notification);
    },
    onCount: (count) => setUnreadCount(queryClient, count),
    onFriendsChanged: () => void invalidateFriendData(queryClient),
    onRevoked: () => logout(),
  };
}
