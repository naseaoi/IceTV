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
