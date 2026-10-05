'use client';

import type { NotificationDto } from '@autoc/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io } from 'socket.io-client';
import { session } from '@/lib/api';
import { API_ORIGIN } from '@/lib/api/config';
import { useAuth } from '@/lib/auth/auth-provider';
import { notify } from '@/lib/toast';
import { describeNotification } from '@/features/notifications/describe';
import { useNotificationTitle } from '@/features/notifications/notification-item';
import { bindRealtimeHandlers, createRealtimeConnection, type IoFactory } from './client';
import { createAppRealtimeHandlers } from './handlers';

const RealtimeStatusContext = createContext<boolean>(false);

/** Whether the realtime socket is connected (e.g. to slow down polling fallbacks). */
export function useRealtimeConnected(): boolean {
  return useContext(RealtimeStatusContext);
}

/** Keeps one Socket.IO connection per tab while signed in; wires server events into the query cache. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const t = useTranslations('notifications');
  const titleFor = useNotificationTitle();
  const [connected, setConnected] = useState(false);

  // Handlers read the latest translations/router without reconnecting.
  const latest = useRef({ titleFor, router, t });
  latest.current = { titleFor, router, t };

  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    const connection = createRealtimeConnection({
      io: io as unknown as IoFactory,
      origin: API_ORIGIN,
      getToken: session.getAccessToken,
      refresh: (stale) => session.refresh(stale),
    });
    const { socket } = connection;
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    const unbind = bindRealtimeHandlers(
      socket,
      createAppRealtimeHandlers({
        queryClient,
        logout: () => session.clear('expired'),
        toast: (notification: NotificationDto) => {
          const { titleFor: title, router: nav, t: tr } = latest.current;
          const { href } = describeNotification(notification);
          notify.info(title(notification), {
            id: `notification-${notification.id}`,
            action: href ? { label: tr('open'), onClick: () => nav.push(href) } : undefined,
          });
        },
      }),
    );

    // A refreshed token (this or another tab) lets a socket that failed auth try again.
    const unsubscribe = session.subscribe((event) => {
      if (event.type === 'token') connection.connect();
    });
    connection.connect();

    return () => {
      unsubscribe();
      unbind();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      connection.disconnect();
      setConnected(false);
    };
  }, [status, queryClient]);

  // Exposed for e2e tests and debugging (`<html data-realtime="connected">`).
  useEffect(() => {
    document.documentElement.dataset.realtime = connected ? 'connected' : 'disconnected';
  }, [connected]);

  return <RealtimeStatusContext.Provider value={connected}>{children}</RealtimeStatusContext.Provider>;
}
