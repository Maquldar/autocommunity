'use client';

import type { Me } from '@autoc/shared';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { AccountBlockedScreen } from '@/components/auth/account-blocked-screen';
import { ErrorState } from '@/components/ui/error-state';
import { useErrorMessage } from '@/hooks/use-error-message';
import { HOME_ROUTE, loginUrl, ONBOARDING_ROUTE } from '@/lib/routes';
import { useAuth } from './auth-provider';

const CurrentUserContext = createContext<Me | null>(null);

/** The signed-in user inside <RequireAuth>. */
export function useCurrentUser(): Me {
  const me = useContext(CurrentUserContext);
  if (!me) throw new Error('useCurrentUser must be used inside <RequireAuth>');
  return me;
}

type Mode = 'app' | 'onboarding';

/** Where a guarded page must send the user instead of rendering, or null to render. */
export function guardRedirect(mode: Mode, me: Pick<Me, 'onboardingCompleted'>): string | null {
  if (mode === 'app' && !me.onboardingCompleted) return ONBOARDING_ROUTE;
  if (mode === 'onboarding' && me.onboardingCompleted) return HOME_ROUTE;
  return null;
}

/**
 * Client-side route guard.
 * - `app`: signed in and onboarded (otherwise → /login?next= or /onboarding)
 * - `onboarding`: signed in and not yet onboarded (otherwise → /login or home)
 * Shows `fallback` (a layout-matching skeleton) while the session is being restored.
 */
export function RequireAuth({ mode, fallback, children }: { mode: Mode; fallback: ReactNode; children: ReactNode }) {
  const { status, logoutReason, afterLogoutPath, me, retryBootstrap } = useAuth();
  const router = useRouter();
  const errorMessage = useErrorMessage();

  const user = status === 'authenticated' ? me.data : undefined;
  const redirect = status === 'anonymous' ? 'login' : user ? guardRedirect(mode, user) : null;

  useEffect(() => {
    if (!redirect) return;
    if (redirect !== 'login') {
      router.replace(redirect);
      return;
    }
    if (logoutReason === 'user') {
      router.replace(afterLogoutPath);
      return;
    }
    // Session expired or never existed: come back here after signing in.
    const here = `${window.location.pathname}${window.location.search}`;
    router.replace(mode === 'app' ? loginUrl(here) : loginUrl());
  }, [redirect, router, mode, logoutReason, afterLogoutPath]);

  if (status === 'blocked') return <AccountBlockedScreen />;
  if (status === 'error') return <ErrorState onRetry={retryBootstrap} />;
  if (status === 'authenticated' && me.isError && !me.data) {
    return <ErrorState description={errorMessage(me.error)} onRetry={() => void me.refetch()} retrying={me.isFetching} />;
  }
  if (!user || redirect) return fallback;
  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>;
}
