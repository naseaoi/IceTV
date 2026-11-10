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
  | 'pending-reports';
export interface AdminAlert {
  key: string;
  type: AdminAlertType;
  message: string;
  startedAt: number;
  count: number;
}
export const ADMIN_ALERT_TABS = {
  'source-offline': 'video-source',
  'subscription-failed': 'config-file',
  'pending-reports': 'reviews',
} as const;
