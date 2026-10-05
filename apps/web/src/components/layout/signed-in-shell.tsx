'use client';

import { useEffect, type ReactNode } from 'react';
import { AccountMenu } from '@/components/shell/account-menu';
import { AppShell } from '@/components/shell/app-shell';
import { LiveNotificationBell } from '@/components/shell/live-notification-bell';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth/auth-provider';
import { RequireAuth, useCurrentUser } from '@/lib/auth/guards';
import { LocationProvider } from '@/lib/location/location-provider';
import { registerServiceWorker } from '@/lib/push/push';
import { RealtimeProvider } from '@/lib/realtime/realtime-provider';

/** AppShell for signed-in, onboarded users. The page area shows `fallback` until the session is known. */
export function SignedInShell({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { status, me, logout } = useAuth();
  const user = status === 'authenticated' ? me.data : undefined;

  useEffect(() => {
    // The worker only handles Web Push; registering early lets the settings switch subscribe instantly.
    void registerServiceWorker();
  }, []);

  return (
    <RealtimeProvider>
      <AppShell
        notificationSlot={<LiveNotificationBell />}
        accountSlot={
          user ? (
            <AccountMenu user={user} onLogout={() => void logout()} />
          ) : (
            <Skeleton className="ms-1 size-8 rounded-full" />
          )
        }
      >
        <RequireAuth mode="app" fallback={fallback}>
          <SignedInProviders>{children}</SignedInProviders>
        </RequireAuth>
      </AppShell>
    </RealtimeProvider>
  );
}

/** Providers that need the onboarded user. */
function SignedInProviders({ children }: { children: ReactNode }) {
  const me = useCurrentUser();
  return <LocationProvider userId={me.id}>{children}</LocationProvider>;
}

/** Generic page skeleton: header block + a few rows. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-4 pt-2">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="mt-4 h-32 w-full rounded-2xl" />
      <Skeleton className="h-20 w-full rounded-2xl" />
    </div>
  );
}
