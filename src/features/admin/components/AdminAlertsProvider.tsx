'use client';

import { useRouter } from 'next/navigation';
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
  getAdminAlertHref,
} from '@/features/admin/lib/admin-alerts';
import { useVisibilityPolling } from '@/hooks/useVisibilityPolling';
import { claimAdminAlertNotices } from '@/lib/admin-alert-notices';
import { showToast } from '@/lib/toast';

const AdminAlertsContext = createContext<AdminAlert[]>([]);
const AdminAlertsRefreshContext = createContext<() => void>(() => {});

export function AdminAlertsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // 跳转只在点击时读取，不让路由对象身份牵动轮询
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
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
        const alertByNoticeKey = new Map(
          alerts.map((alert) => [`admin-alert:${alert.key}`, alert]),
        );
        for (const notice of claimAdminAlertNotices(accountKey, alerts)) {
          const alert = notice.recovered
            ? undefined
            : alertByNoticeKey.get(notice.key);
          const href = alert && getAdminAlertHref(alert);
          showToast(notice.message, notice.recovered ? 'success' : 'notice', {
            key: notice.key,
            ...(href
              ? {
                  action: {
                    label: '查看',
                    onClick: () => routerRef.current.push(href),
                  },
                }
              : {}),
          });
        }
      }
    } catch {
      // 后台轮询失败保留上次结果，不把请求错误当作告警恢复。
    } finally {
      if (controller.current === request) controller.current = null;
    }
  }, [accountKey]);
  const refresh = useCallback(() => {
    lastPollAt.current = 0;
    void poll();
  }, [poll]);

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
      <AdminAlertsRefreshContext.Provider value={refresh}>
        {children}
      </AdminAlertsRefreshContext.Provider>
    </AdminAlertsContext.Provider>
  );
}

export function useAdminAlerts() {
  return useContext(AdminAlertsContext);
}

/** 处理后立即重新拉取告警，不等下一轮轮询 */
export function useRefreshAdminAlerts() {
  return useContext(AdminAlertsRefreshContext);
}
