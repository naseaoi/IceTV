import { act, render, screen } from '@testing-library/react';

import { useAuthSession } from '@/components/AuthProvider';
import { ADMIN_ALERT_POLL_MS } from '@/features/admin/lib/admin-alerts';
import { claimAdminAlertNotices } from '@/lib/admin-alert-notices';
import { showToast } from '@/lib/toast';

import { AdminAlertBadge } from './AdminAlertBadge';
import { AdminAlertsProvider } from './AdminAlertsProvider';

jest.mock('@/components/AuthProvider', () => ({ useAuthSession: jest.fn() }));
jest.mock('@/lib/admin-alert-notices', () => ({
  claimAdminAlertNotices: jest.fn(() => []),
}));
jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));
const alert = {
  key: 'subscription-failed',
  type: 'subscription-failed',
  message: '订阅定时更新失败',
  startedAt: 1,
  count: 1,
};
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(document, 'hasFocus').mockReturnValue(true);
  (useAuthSession as jest.Mock).mockReturnValue({
    session: { status: 'authenticated', role: 'owner', username: 'owner' },
  });
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ alerts: [alert] }) });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
const ui = () => (
  <AdminAlertsProvider>
    <AdminAlertBadge />
    <AdminAlertBadge tab='config-file' />
    <AdminAlertBadge tab='reviews' />
  </AdminAlertsProvider>
);
it('shares alert counts with entry and matching tab and polls no faster than five minutes', async () => {
  render(ui());
  await act(async () => undefined);
  expect(screen.getAllByLabelText('1 项管理员提醒')).toHaveLength(2);
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(ADMIN_ALERT_POLL_MS);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('does not poll for normal users or guests', async () => {
  (useAuthSession as jest.Mock).mockReturnValue({
    session: { status: 'authenticated', role: 'user', username: 'user' },
  });
  const view = render(ui());
  await act(async () => {
    jest.advanceTimersByTime(ADMIN_ALERT_POLL_MS);
  });
  expect(fetch).not.toHaveBeenCalled();
  (useAuthSession as jest.Mock).mockReturnValue({
    session: { status: 'guest' },
  });
  view.rerender(ui());
  expect(fetch).not.toHaveBeenCalled();
});
it('shows fixed-key transitions and preserves badges on failed polling', async () => {
  jest.mocked(claimAdminAlertNotices).mockReturnValueOnce([
    {
      key: 'admin-alert:subscription-failed',
      message: alert.message,
      recovered: false,
    },
  ]);
  render(ui());
  await act(async () => undefined);
  expect(showToast).toHaveBeenCalledWith(alert.message, 'notice', {
    key: 'admin-alert:subscription-failed',
  });
  (fetch as jest.Mock).mockResolvedValue({ ok: false });
  await act(async () => {
    jest.advanceTimersByTime(ADMIN_ALERT_POLL_MS);
  });
  expect(screen.getAllByLabelText('1 项管理员提醒')).toHaveLength(2);
  expect(claimAdminAlertNotices).toHaveBeenCalledTimes(1);
});
