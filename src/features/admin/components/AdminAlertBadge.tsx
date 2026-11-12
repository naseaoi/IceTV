'use client';

import AnimatedCount from '@/components/AnimatedCount';
import { useAdminAlerts } from '@/features/admin/components/AdminAlertsProvider';
import { ADMIN_ALERT_TABS } from '@/features/admin/lib/admin-alerts';
import type { AdminTabId } from '@/features/admin/lib/admin-tabs';

export function AdminAlertBadge({ tab }: { tab?: AdminTabId }) {
  const alerts = useAdminAlerts().filter(
    (alert) => !tab || ADMIN_ALERT_TABS[alert.type] === tab,
  );
  const count = alerts.reduce((sum, alert) => sum + alert.count, 0);
  if (!count) return null;
  return (
    <span
      aria-label={`${count} 项管理员提醒`}
      title={alerts.map((alert) => alert.message).join('；')}
      className='inline-flex min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white'
    >
      <AnimatedCount value={count} />
    </span>
  );
}
