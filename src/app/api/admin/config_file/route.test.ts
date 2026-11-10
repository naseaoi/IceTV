/** @jest-environment node */
import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { getConfig, saveConfig } from '@/lib/config';
import { db } from '@/lib/db';

installWebPolyfills();
jest.mock('@/lib/api-auth', () => ({
  requireOwner: jest.fn(async () => ({ isOwner: true })),
  isGuardFailure: () => false,
}));
jest.mock('@/lib/api-config-error', () => ({
  configConflictResponse: () => null,
}));
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  invalidateConfigCache: jest.fn(),
  refineConfig: jest.fn(),
  saveConfig: jest.fn(),
}));
jest.mock('@/lib/db', () => ({ db: { getConfigSubscription: jest.fn() } }));
const { POST } = require('./route') as typeof import('./route');
const sub = {
  URL: 'https://example.com/config',
  AutoUpdate: true,
  LastCheck: '2026-11-01T00:00:00Z',
  FailureSince: '2026-11-10T00:00:00Z',
};
beforeEach(() => {
  jest.clearAllMocks();
  (getConfig as jest.Mock).mockResolvedValue({});
  (db.getConfigSubscription as jest.Mock).mockResolvedValue({
    ConfigFile: '{}',
    ConfigSubscribtion: sub,
  });
});
it.each([
  [{ lastCheckTime: sub.LastCheck }, sub.FailureSince],
  [{ autoUpdate: false }, sub.FailureSince],
  [{ subscriptionUrl: 'https://example.com/new' }, undefined],
  [{ lastCheckTime: '2026-11-11T00:00:00Z' }, undefined],
])(
  'preserves failure on simple saves and clears on changed subscription or refresh (%j)',
  async (body, expected) => {
    const request = {
      json: async () => ({ configFile: '{}', ...body }),
    } as import('next/server').NextRequest;
    expect((await POST(request)).status).toBe(200);
    expect(
      (saveConfig as jest.Mock).mock.calls[0][1].subscription.next
        .ConfigSubscribtion.FailureSince,
    ).toBe(expected);
  },
);
