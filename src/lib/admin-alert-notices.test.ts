import {
  type AdminAlert,
  ADMIN_ALERT_COOLDOWN_MS,
} from '@/features/admin/lib/admin-alerts';

import { claimAdminAlertNotices } from './admin-alert-notices';
import { readStorage, writeStorage } from './browser-storage';

jest.mock('./browser-storage', () => ({
  readStorage: jest.fn(),
  writeStorage: jest.fn(),
}));
let storage: Map<string, string>;
let account = 0;
beforeEach(() => {
  storage = new Map();
  account += 1;
  jest
    .mocked(readStorage)
    .mockImplementation((key) => storage.get(key) ?? null);
  jest.mocked(writeStorage).mockImplementation((key, value) => {
    storage.set(key, value);
    return true;
  });
});
const alert: AdminAlert = {
  key: 'source-offline:one',
  type: 'source-offline',
  message: '视频源持续失效',
  startedAt: 100,
  count: 1,
};
it('notifies onset and recovery once, persists keys and allows recurrence', () => {
  const user = `owner${account}`;
  expect(claimAdminAlertNotices(user, [alert], 1000)).toHaveLength(1);
  expect(
    claimAdminAlertNotices(user, [alert], ADMIN_ALERT_COOLDOWN_MS + 1000),
  ).toEqual([]);
  expect(
    claimAdminAlertNotices(user, [], ADMIN_ALERT_COOLDOWN_MS + 1001),
  ).toEqual([
    expect.objectContaining({
      recovered: true,
      key: 'admin-alert:source-offline:one',
    }),
  ]);
  expect(
    claimAdminAlertNotices(user, [], ADMIN_ALERT_COOLDOWN_MS * 2 + 1001),
  ).toEqual([]);
  expect(
    claimAdminAlertNotices(user, [alert], ADMIN_ALERT_COOLDOWN_MS * 3),
  ).toHaveLength(1);
  expect(writeStorage).toHaveBeenCalled();
});
it('cools rapid changes and new reports, independently per account', () => {
  const user = `owner${account}`;
  const report: AdminAlert = {
    ...alert,
    key: 'pending-reports',
    type: 'pending-reports',
  };
  expect(claimAdminAlertNotices(user, [report], 1000)).toHaveLength(1);
  expect(
    claimAdminAlertNotices(user, [{ ...report, startedAt: 200 }], 2000),
  ).toEqual([]);
  expect(
    claimAdminAlertNotices(
      user,
      [{ ...report, startedAt: 200 }],
      ADMIN_ALERT_COOLDOWN_MS + 1000,
    ),
  ).toHaveLength(1);
  expect(claimAdminAlertNotices(`${user}-other`, [report], 2000)).toHaveLength(
    1,
  );
});
it('keeps same-tab deduplication when persistence fails', () => {
  jest.mocked(writeStorage).mockReturnValue(false);
  const user = `owner${account}`;
  expect(claimAdminAlertNotices(user, [alert], 1000)).toHaveLength(1);
  expect(
    claimAdminAlertNotices(user, [alert], ADMIN_ALERT_COOLDOWN_MS * 2),
  ).toEqual([]);
});
