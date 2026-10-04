'use client';

import type { AuthResult, Me } from '@autoc/shared';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, session, type LogoutReason } from '@/lib/api';
import { LOGIN_ROUTE } from '@/lib/routes';

export const ME_QUERY_KEY = ['me'] as const;

/**
 * - `loading`: restoring the session on app load (refresh → /me)
 * - `error`: couldn't reach the API to find out; offer a retry
 * - `blocked`: ACCOUNT_BLOCKED from the API; the session was dropped
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'blocked' | 'error';

type AuthContextValue = {
  status: AuthStatus;
  /** Why the user is anonymous after having been signed in (null on a fresh visit). */
  logoutReason: LogoutReason | null;
  me: UseQueryResult<Me>;
  /** Store a successful verify / OAuth result (token in memory, user in the query cache). */
  completeSignIn: (result: AuthResult) => void;
  /** Where guarded pages go after a user-initiated sign-out (default /login). */
  afterLogoutPath: string;
  logout: (redirectTo?: string) => Promise<void>;
  logoutAll: (redirectTo?: string) => Promise<void>;
  /** Local cleanup after DELETE /me (the server already cleared the cookies). */
  forgetSession: (redirectTo?: string) => void;
  /** Leave the blocked / error screens. */
  retryBootstrap: () => void;
  dismissBlocked: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [logoutReason, setLogoutReason] = useState<LogoutReason | null>(null);
  const [afterLogoutPath, setAfterLogoutPath] = useState(LOGIN_ROUTE);

  useEffect(() => {
    return session.subscribe((event) => {
      if (event.type === 'token') {
        setStatus((current) => (current === 'blocked' ? current : 'authenticated'));
      } else {
        queryClient.removeQueries();
        if (event.type === 'logout') setLogoutReason(event.reason);
        setStatus(event.type === 'blocked' ? 'blocked' : 'anonymous');
      }
    });
  }, [queryClient]);

  // Session bootstrap: a token may already exist (another tab shared it); otherwise try a refresh.
  useEffect(() => {
    let cancelled = false;
    if (session.getAccessToken()) {
      setStatus('authenticated');
      return undefined;
    }
    if (!session.hasStoredSession()) {
      setStatus('anonymous');
      return undefined;
    }
    session
      .refresh(null)
      .then((token) => {
        if (cancelled) return;
        setStatus((current) => (current === 'loading' || current === 'error' ? (token ? 'authenticated' : 'anonymous') : current));
      })
      .catch(() => {
        if (!cancelled) setStatus((current) => (current === 'loading' ? 'error' : current));
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const me = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: api.me.get,
    enabled: status === 'authenticated',
  });

  const completeSignIn = useCallback(
    (result: AuthResult) => {
      queryClient.setQueryData(ME_QUERY_KEY, result.user);
      session.setAccessToken(result.accessToken);
      setLogoutReason(null);
      setStatus('authenticated');
    },
    [queryClient],
  );

  const logout = useCallback(async (redirectTo = LOGIN_ROUTE) => {
    setAfterLogoutPath(redirectTo);
    await session.logout();
  }, []);

  const logoutAll = useCallback(async (redirectTo = LOGIN_ROUTE) => {
    await api.auth.logoutAll();
    setAfterLogoutPath(redirectTo);
    session.clear('user');
  }, []);

  const forgetSession = useCallback((redirectTo = LOGIN_ROUTE) => {
    setAfterLogoutPath(redirectTo);
    session.clear('user');
  }, []);

  const retryBootstrap = useCallback(() => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  }, []);

  const dismissBlocked = useCallback(() => setStatus('anonymous'), []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, logoutReason, afterLogoutPath, me, completeSignIn, logout, logoutAll, forgetSession, retryBootstrap, dismissBlocked }),
    [status, logoutReason, afterLogoutPath, me, completeSignIn, logout, logoutAll, forgetSession, retryBootstrap, dismissBlocked],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
