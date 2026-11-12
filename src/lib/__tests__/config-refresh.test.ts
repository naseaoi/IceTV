/** @jest-environment node */

import {
  ConfigConflictError,
  configSelfCheck,
  getConfig,
  invalidateConfigCache,
  saveConfig,
} from '@/lib/config';
import { subscriptionFromConfig } from '@/lib/config-state';
import { refreshSubscribedConfig } from '@/lib/cron/config-refresh';
import { db } from '@/lib/db';
import { fetchWithUrlGuard } from '@/lib/url-guard';
import type { AdminConfig } from '@/types/admin';

jest.mock('@/lib/config', () => ({
  ...jest.requireActual('@/lib/config'),
  getConfig: jest.fn(),
  invalidateConfigCache: jest.fn(),
  saveConfig: jest.fn(),
}));
jest.mock('@/lib/db', () => ({
  db: {
    getConfigSubscription: jest.fn(),
    getAdminConfig: jest.fn(),
    compareAndSetAdminConfig: jest.fn(),
  },
}));
jest.mock('@/lib/config-subscription', () => ({
  readConfigSubscriptionText: jest.fn(async () => '{}'),
  decodeConfigSubscriptionContent: jest.fn(
    async () =>
      '{"api_site":{"one":{"name":"One","api":"https://example.com/api"}}}',
  ),
}));
jest.mock('@/lib/url-guard', () => ({ fetchWithUrlGuard: jest.fn() }));

const subscription = subscriptionFromConfig({
  ConfigFile: '{}',
  ConfigSubscribtion: {
    URL: 'https://example.com/sub',
    AutoUpdate: true,
    LastCheck: '',
  },
});
function config(): AdminConfig {
  return configSelfCheck({
    SourceConfig: [
      {
        key: 'one',
        name: 'One',
        api: 'https://example.com/api',
        from: 'config',
      },
    ],
    CustomCategories: [],
    LiveConfig: [],
  } as unknown as AdminConfig);
}

describe('subscribed config refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.getConfigSubscription as jest.Mock).mockResolvedValue(subscription);
    (fetchWithUrlGuard as jest.Mock).mockResolvedValue({ ok: true });
    (getConfig as jest.Mock).mockResolvedValue(config());
    (db.getAdminConfig as jest.Mock).mockResolvedValue(config());
    (db.compareAndSetAdminConfig as jest.Mock).mockResolvedValue(true);
    (saveConfig as jest.Mock).mockResolvedValue(config());
  });

  it('updates LastCheck and raw content without saving unchanged config', async () => {
    await refreshSubscribedConfig();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(invalidateConfigCache).toHaveBeenCalledTimes(1);
    expect(
      (invalidateConfigCache as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan((getConfig as jest.Mock).mock.invocationCallOrder[0]);
    expect(db.compareAndSetAdminConfig).toHaveBeenCalledWith(
      config(),
      config(),
      expect.objectContaining({
        subscription: {
          expected: subscription,
          next: expect.objectContaining({
            ConfigSubscribtion: expect.objectContaining({
              LastCheck: expect.any(String),
            }),
          }),
        },
      }),
    );
  });

  it('saves changed sources together with subscription state', async () => {
    (getConfig as jest.Mock).mockResolvedValue({
      ...config(),
      SourceConfig: [],
    });
    await refreshSubscribedConfig();
    expect(saveConfig).toHaveBeenCalledTimes(1);
    const [next, state] = (saveConfig as jest.Mock).mock.calls[0];
    expect(next.SourceConfig).toHaveLength(1);
    expect(next.ConfigFile).toBeUndefined();
    expect(state.subscription.expected).toEqual(subscription);
    expect(db.compareAndSetAdminConfig).not.toHaveBeenCalled();
  });

  it('keeps subscription state untouched when config save conflicts', async () => {
    const log = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    (getConfig as jest.Mock).mockResolvedValue({
      ...config(),
      SourceConfig: [],
    });
    (saveConfig as jest.Mock).mockRejectedValue(new ConfigConflictError());
    await refreshSubscribedConfig();
    expect(db.compareAndSetAdminConfig).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('rejects a concurrent config change even when fetched content was unchanged', async () => {
    const log = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    (db.getAdminConfig as jest.Mock).mockResolvedValue({
      ...config(),
      SourceConfig: [],
    });
    await refreshSubscribedConfig();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(db.compareAndSetAdminConfig).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('records the first failure without replacing its timestamp on repeated failures', async () => {
    const log = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    (fetchWithUrlGuard as jest.Mock).mockRejectedValue(
      new Error('private error'),
    );
    await refreshSubscribedConfig();
    const update = (db.compareAndSetAdminConfig as jest.Mock).mock.calls[0][2];
    expect(update.subscription.expected).toBe(subscription);
    expect(update.subscription.next.ConfigSubscribtion.FailureSince).toEqual(
      expect.any(String),
    );
    (db.getConfigSubscription as jest.Mock).mockResolvedValue(
      update.subscription.next,
    );
    await refreshSubscribedConfig();
    expect(
      (db.compareAndSetAdminConfig as jest.Mock).mock.calls[1][2].subscription
        .next.ConfigSubscribtion.FailureSince,
    ).toBe(update.subscription.next.ConfigSubscribtion.FailureSince);
    log.mockRestore();
  });

  it('clears the persisted failure on successful refresh', async () => {
    (db.getConfigSubscription as jest.Mock).mockResolvedValue({
      ...subscription,
      ConfigSubscribtion: {
        ...subscription.ConfigSubscribtion,
        FailureSince: '2026-11-01T00:00:00Z',
      },
    });
    await refreshSubscribedConfig();
    expect(
      (db.compareAndSetAdminConfig as jest.Mock).mock.calls[0][2].subscription
        .next.ConfigSubscribtion.FailureSince,
    ).toBe('');
  });

  it('skips disabled subscriptions before reading config', async () => {
    (db.getConfigSubscription as jest.Mock).mockResolvedValue(
      subscriptionFromConfig(),
    );
    await refreshSubscribedConfig();
    expect(getConfig).not.toHaveBeenCalled();
    expect(fetchWithUrlGuard).not.toHaveBeenCalled();
  });
});
