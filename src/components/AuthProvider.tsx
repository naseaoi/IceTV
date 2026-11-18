'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { AUTH_SESSION_LOST_EVENT } from '@/lib/auth.client';
import { ClientAuthSession } from '@/lib/auth-session';
import { getClientAuthSession } from '@/lib/auth-session.client';
import { PROFILE_REQUIRED_EVENT } from '@/lib/profile.client';
import { WATCH_LEVEL_UP_EVENT } from '@/lib/watch-level';

type AuthContextValue = {
  session: ClientAuthSession;
  isRefreshing: boolean;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  initialSession,
}: {
  children: ReactNode;
  initialSession: ClientAuthSession;
}) {
  const [session, setSession] = useState(initialSession);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setSession(initialSession);
  }, [initialSession]);

  const refreshSession = useCallback(async () => {
    setIsRefreshing(true);
    try {
      setSession(await getClientAuthSession());
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const handleSessionLost = () => {
      setSession({ status: 'guest' });
      setIsRefreshing(false);
    };

    window.addEventListener(AUTH_SESSION_LOST_EVENT, handleSessionLost);
    return () => {
      window.removeEventListener(AUTH_SESSION_LOST_EVENT, handleSessionLost);
    };
  }, []);

  useEffect(() => {
    const handleSessionStale = () => {
      void refreshSession();
    };
    window.addEventListener(PROFILE_REQUIRED_EVENT, handleSessionStale);
    window.addEventListener(WATCH_LEVEL_UP_EVENT, handleSessionStale);
    return () => {
      window.removeEventListener(PROFILE_REQUIRED_EVENT, handleSessionStale);
      window.removeEventListener(WATCH_LEVEL_UP_EVENT, handleSessionStale);
    };
  }, [refreshSession]);

  const value = useMemo(
    () => ({ session, isRefreshing, refreshSession }),
    [isRefreshing, refreshSession, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthSession(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthSession 必须在 AuthProvider 内使用');
  }

  return context;
}
