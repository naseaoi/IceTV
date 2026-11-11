import type {
  AdminAlert,
  AdminAlertType,
} from '@/features/admin/lib/admin-alerts';
import { ADMIN_ALERT_COOLDOWN_MS } from '@/features/admin/lib/admin-alerts';
import { readStorage, writeStorage } from '@/lib/browser-storage';

interface AlertNoticeState {
  active: boolean;
  revision: number;
  notifiedAt: number;
  type: AdminAlertType;
  group?: string;
}
type NoticeHistory = Record<string, AlertNoticeState>;
const memory = new Map<string, NoticeHistory>();
const RECOVERY_TEXT: Record<AdminAlertType, string> = {
  'source-offline': '视频源持续失效告警已解除',
  'subscription-failed': '订阅更新告警已解除',
  'pending-reports': '待处理举报已处理完毕',
  traffic: '流量告警已解除',
};

function readHistory(key: string): NoticeHistory {
  const raw = readStorage(key);
  if (raw) {
    try {
      const value = JSON.parse(raw) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const stored = Object.fromEntries(
          Object.entries(value).filter(
            ([, item]) =>
              item &&
              typeof item === 'object' &&
              typeof item.active === 'boolean' &&
              Number.isFinite(item.revision) &&
              Number.isFinite(item.notifiedAt) &&
              Object.hasOwn(RECOVERY_TEXT, item.type) &&
              (item.group === undefined || typeof item.group === 'string'),
          ),
        ) as NoticeHistory;
        for (const [alertKey, item] of Object.entries(memory.get(key) ?? {})) {
          if (
            !stored[alertKey] ||
            item.notifiedAt > stored[alertKey].notifiedAt
          )
            stored[alertKey] = item;
        }
        return stored;
      }
    } catch {
      // 损坏的浏览器数据回退为当前标签页状态。
    }
  }
  return memory.get(key) ?? {};
}

export function claimAdminAlertNotices(
  username: string,
  alerts: AdminAlert[],
  now = Date.now(),
) {
  const key = `admin-alert-notices:v1:${encodeURIComponent(username)}`;
  const history = readHistory(key);
  const current = new Map(alerts.map((alert) => [alert.key, alert]));
  const currentGroups = new Set(
    alerts.flatMap((alert) => (alert.group ? [alert.group] : [])),
  );
  const notices: { key: string; message: string; recovered: boolean }[] = [];
  for (const alert of alerts) {
    const previous = history[alert.key];
    const isNewReport =
      alert.type === 'pending-reports' &&
      previous &&
      alert.startedAt > previous.revision;
    if (previous?.active && !isNewReport) continue;
    if (previous && now - previous.notifiedAt < ADMIN_ALERT_COOLDOWN_MS)
      continue;
    notices.push({
      key: `admin-alert:${alert.key}`,
      message: alert.message,
      recovered: false,
    });
    history[alert.key] = {
      active: true,
      revision: alert.startedAt,
      notifiedAt: now,
      type: alert.type,
      ...(alert.group ? { group: alert.group } : {}),
    };
  }
  for (const [alertKey, previous] of Object.entries(history)) {
    if (
      current.has(alertKey) ||
      !previous.active ||
      now - previous.notifiedAt < ADMIN_ALERT_COOLDOWN_MS
    )
      continue;
    if (previous.group && currentGroups.has(previous.group)) {
      history[alertKey] = { ...previous, active: false };
      continue;
    }
    notices.push({
      key: `admin-alert:${alertKey}`,
      message: RECOVERY_TEXT[previous.type],
      recovered: true,
    });
    history[alertKey] = { ...previous, active: false, notifiedAt: now };
  }
  memory.set(key, history);
  writeStorage(key, JSON.stringify(history));
  return notices;
}
