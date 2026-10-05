'use client';

import { useAuth } from '@/lib/auth/auth-provider';
import { useUnreadCount } from '@/features/notifications/queries';
import { NotificationBell } from './notification-bell';

/** Top-bar bell wired to GET /notifications/unread-count (kept live by the socket's `notification:count`). */
export function LiveNotificationBell() {
  const { status, me } = useAuth();
  const ready = status === 'authenticated' && Boolean(me.data?.onboardingCompleted);
  const unread = useUnreadCount(ready);
  if (!ready) return null;
  return <NotificationBell href="/notifications" count={unread.data?.count ?? 0} />;
}
