'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import {
  type AdminAlert,
  ADMIN_ALERT_POLL_MS,
} from '@/features/admin/lib/admin-alerts';
import { useVisibilityPolling } from '@/hooks/useVisibilityPolling';
import { claimAdminAlertNotices } from '@/lib/admin-alert-notices';
import { showToast } from '@/lib/toast';

const AdminAlertsContext = createContext<AdminAlert[]>([]);

export function AdminAlertsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuthSession();
  const accountKey =
    session.status === 'authenticated' &&
    (session.role === 'admin' || session.role === 'owner')
      ? `${session.username}:${session.role}`
      : '';
  const [snapshot, setSnapshot] = useState<{
    accountKey: string;
    alerts: AdminAlert[];
  }>({ accountKey: '', alerts: [] });
  const controller = useRef<AbortController | null>(null);
  const lastPollAt = useRef(0);
  const poll = useCallback(async () => {
    if (
      !accountKey ||
      controller.current ||
      document.visibilityState !== 'visible' ||
      Date.now() - lastPollAt.current < ADMIN_ALERT_POLL_MS
    )
      return;
    lastPollAt.current = Date.now();
    const request = new AbortController();
    controller.current = request;
    try {
      const response = await fetch('/api/admin/alerts', {
        cache: 'no-store',
        signal: request.signal,
      });
      if (!response.ok) return;
      const { alerts } = (await response.json()) as { alerts: AdminAlert[] };
      if (request.signal.aborted) return;
      setSnapshot({ accountKey, alerts });
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        for (const notice of claimAdminAlertNotices(accountKey, alerts)) {
          showToast(notice.message, notice.recovered ? 'success' : 'notice', {
            key: notice.key,
          });
        }
      }
    } catch {
      // 后台轮询失败保留上次结果，不把请求错误当作告警恢复。
    } finally {
      if (controller.current === request) controller.current = null;
    }
  }, [accountKey]);

  useEffect(() => {
    lastPollAt.current = 0;
    void poll();
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [poll]);
  useVisibilityPolling({
    enabled: Boolean(accountKey),
    intervalMs: ADMIN_ALERT_POLL_MS,
    minGapMs: ADMIN_ALERT_POLL_MS,
    onPoll: () => void poll(),
  });

  return (
    <AdminAlertsContext.Provider
      value={snapshot.accountKey === accountKey ? snapshot.alerts : []}
    >
      {children}
    </AdminAlertsContext.Provider>
  );
}

export function useAdminAlerts() {
  return useContext(AdminAlertsContext);
}
