import {
  SOURCE_HEALTH_MIN_OFFLINE_DAYS,
  SOURCE_HEALTH_MIN_SEARCH_ATTEMPTS,
} from '@/lib/source-quality-policy';

export const ADMIN_ALERT_POLL_MS = 5 * 60_000;
export const ADMIN_ALERT_COOLDOWN_MS = 5 * 60_000;
export const ADMIN_SOURCE_FAILURE_MIN_DAYS = SOURCE_HEALTH_MIN_OFFLINE_DAYS;
export const ADMIN_SOURCE_FAILURE_MIN_ATTEMPTS =
  SOURCE_HEALTH_MIN_SEARCH_ATTEMPTS;

export type AdminAlertType =
  | 'source-offline'
  | 'subscription-failed'
  | 'pending-reports'
  | 'traffic';
/** 视频源持续失效的判定依据，后台据此定位并展示该源 */
export interface AdminSourceAlertDetail {
  source: string;
  /** 最后成功日之后出现搜索失败的天数与累计次数 */
  failureDays: number;
  failureCount: number;
  /** UTC 日期 YYYY-MM-DD；窗口内从未成功时为 null */
  lastSuccessDate: string | null;
}
export interface AdminAlert {
  key: string;
  type: AdminAlertType;
  message: string;
  startedAt: number;
  count: number;
  // 同组告警是同一问题的不同等级，换级时不提示旧等级已解除
  group?: string;
  sourceDetail?: AdminSourceAlertDetail;
}
export const ADMIN_ALERT_TABS = {
  'source-offline': 'video-source',
  'subscription-failed': 'config-file',
  'pending-reports': 'reviews',
  traffic: 'traffic',
} as const;

export const ADMIN_SOURCE_FOCUS_PARAM = 'source';

/** 告警对应的后台位置；源告警带上源 key，落地后定位到该行 */
export function getAdminAlertHref(alert: AdminAlert): string {
  const params = new URLSearchParams({ tab: ADMIN_ALERT_TABS[alert.type] });
  if (alert.sourceDetail) {
    params.set(ADMIN_SOURCE_FOCUS_PARAM, alert.sourceDetail.source);
  }
  return `/admin?${params}`;
}
