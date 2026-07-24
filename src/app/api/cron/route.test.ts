/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();

const mockGetConfig = jest.fn();
const mockGetAllUsers = jest.fn();

jest.mock('@/features/live/lib/live', () => ({
  isLiveEntryEnabledInConfig: jest.fn().mockReturnValue(false),
  refreshLiveChannels: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  refineConfig: jest.fn((config) => config),
  saveConfig: jest.fn(),
}));

jest.mock('@/lib/config-subscription', () => ({
  decodeConfigSubscriptionContent: jest.fn(),
  readConfigSubscriptionText: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    getAllUsers: (...args: unknown[]) => mockGetAllUsers(...args),
    getAllPlayRecords: jest.fn().mockResolvedValue({}),
    getAllFavorites: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('@/lib/fetchVideoDetail', () => ({
  fetchVideoDetail: jest.fn(),
}));

jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: jest.fn(),
}));

const { GET } = require('./route') as typeof import('./route');

function createRequest(url = 'http://localhost/api/cron'): NextRequest {
  return {
    url,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'authorization' ? 'Bearer test-secret' : null,
    },
  } as unknown as NextRequest;
}

describe('cron route', () => {
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    jest.clearAllMocks();
    mockGetAllUsers.mockResolvedValue([]);
    mockGetConfig.mockResolvedValue({
      ConfigSubscribtion: { URL: '', AutoUpdate: false },
      LiveConfig: [],
    });
  });

  afterAll(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it('同一进程内拒绝重叠执行', async () => {
    let releaseFirstConfig!: (config: object) => void;
    mockGetConfig
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirstConfig = resolve;
          }),
      )
      .mockResolvedValue({
        ConfigSubscribtion: { URL: '', AutoUpdate: false },
        LiveConfig: [],
      });

    const firstResponse = await GET(createRequest());
    const secondResponse = await GET(createRequest());

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(202);

    releaseFirstConfig({
      ConfigSubscribtion: { URL: '', AutoUpdate: false },
      LiveConfig: [],
    });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const thirdResponse = await GET(createRequest());
    expect(thirdResponse.status).toBe(200);
  });

  it('拒绝未知任务类型', async () => {
    const response = await GET(
      createRequest('http://localhost/api/cron?task=unknown'),
    );

    expect(response.status).toBe(400);
  });
});
