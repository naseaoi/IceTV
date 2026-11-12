/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { refreshLiveChannels } from '@/features/live/lib/live';
import {
  ConfigConflictError,
  getConfig,
  getConfigForRead,
  saveConfig,
} from '@/lib/config';
import { startCronTask } from '@/lib/cron/runner';
import { getCachedDetail } from '@/lib/detail-cache';
import { resolveGirigiriEpisodePlayUrlByPath } from '@/lib/downstream-sources/giri';
import { validateProxyUrlForRequest } from '@/lib/url-guard';

installWebPolyfills();

jest.mock('@/lib/api-auth', () => ({
  requireAdmin: jest.fn().mockResolvedValue({ username: 'admin' }),
  requireActiveUser: jest.fn().mockResolvedValue({ username: 'user' }),
  isGuardFailure: () => false,
}));
jest.mock('@/features/play/lib/sourceProbeGuard.server', () => ({
  withAuthenticatedSourceProbeBudget: (
    request: NextRequest,
    handler: (request: NextRequest, auth: object) => Promise<Response>,
  ) => handler(request, { username: 'user', isOwner: false, role: 'user' }),
  withSourceProbeBudget: (
    request: NextRequest,
    handler: (request: NextRequest) => Promise<Response>,
  ) => handler(request),
}));
jest.mock('@/lib/config', () => ({
  ConfigConflictError: class extends Error {
    constructor() {
      super('配置已更新，请刷新后重试');
    }
  },
  getConfig: jest.fn(),
  getConfigForRead: jest.fn(),
  getAvailableApiSites: jest.fn().mockResolvedValue([{ key: 'giri' }]),
  invalidateConfigCache: jest.fn(),
  saveConfig: jest.fn(),
}));
jest.mock('@/lib/config-file-json', () => ({
  buildConfigFileFromAdminConfig: jest.fn().mockReturnValue('{}'),
  removeConfigFileEntries: jest.fn(),
}));
jest.mock('@/lib/db', () => ({
  db: {
    getConfigSubscription: jest.fn().mockResolvedValue({ ConfigFile: '{}' }),
  },
}));
jest.mock('@/features/live/lib/live', () => ({
  isLiveEntryEnabledInConfig: jest.fn().mockReturnValue(true),
  refreshLiveChannelSources: jest.fn(),
  refreshLiveChannels: jest.fn(),
  deleteCachedLiveChannels: jest.fn(),
}));
jest.mock('@/lib/url-guard', () => ({ validateProxyUrlForRequest: jest.fn() }));
jest.mock('@/lib/cron/request', () => ({
  isCronAuthorized: () => true,
  parseCronTask: () => 'all',
}));
jest.mock('@/lib/cron/runner', () => ({ startCronTask: jest.fn() }));
jest.mock('@/lib/detail-cache', () => ({ getCachedDetail: jest.fn() }));
jest.mock('@/lib/downstream-sources/giri', () => ({
  isGirigiriSource: () => true,
  resolveGirigiriEpisodePlayUrlByPath: jest.fn(),
}));
jest.mock('@/lib/downstream-sources/xgcartoon', () => ({
  isXgcartoonSource: () => false,
  resolveXgcartoonEpisodeUrlByPath: jest.fn(),
}));

const { POST: livePost } = require('@/app/api/admin/live/route');
const { POST: refreshPost } = require('@/app/api/admin/live/refresh/route');
const { GET: cronGet } = require('@/app/api/cron/route');
const { GET: detailGet } = require('@/app/api/detail/route');
const { GET: episodeGet } = require('@/app/api/episode-url/route');

const request = (body: object = {}) =>
  ({
    url: 'http://localhost/api/test?id=1&source=giri&url=icetv-lazy://giri/playGV1-1-1/',
    headers: new Headers(),
    signal: new AbortController().signal,
    json: async () => body,
  }) as NextRequest;
const liveBody = {
  action: 'add',
  key: 'live',
  name: 'Live',
  url: 'https://example.com/live.m3u',
};

beforeEach(() => {
  jest.clearAllMocks();
  (getConfig as jest.Mock).mockResolvedValue({ LiveConfig: [] });
  (getConfigForRead as jest.Mock).mockResolvedValue({ LiveConfig: [] });
  (validateProxyUrlForRequest as jest.Mock).mockResolvedValue({ ok: true });
  (refreshLiveChannels as jest.Mock).mockResolvedValue(1);
  (saveConfig as jest.Mock).mockResolvedValue(undefined);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

it.each([
  ['live', getConfig, () => livePost(request(liveBody)), '操作失败'],
  ['refresh', getConfigForRead, () => refreshPost(request()), '刷新失败'],
  ['cron', startCronTask, () => cronGet(request()), '定时任务执行失败'],
  ['detail', getCachedDetail, () => detailGet(request()), '获取视频详情失败'],
  [
    'episode',
    resolveGirigiriEpisodePlayUrlByPath,
    () => episodeGet(request()),
    '播放地址解析失败',
  ],
] as const)(
  '%s hides unexpected exceptions and logs the original error',
  async (_name, dependency, handler, message) => {
    const error = new Error('mysql://user:secret@internal/private');
    (dependency as jest.Mock).mockRejectedValueOnce(error);
    const response = await handler();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: message });
    expect(console.error).toHaveBeenCalledWith(expect.any(String), error);
  },
);

it.each(['add', 'edit'])(
  '%s hides upstream errors without changing the 400 status',
  async (action) => {
    const error = new Error('https://private.example/?token=secret');
    (getConfig as jest.Mock).mockResolvedValue({
      LiveConfig: [{ ...liveBody }],
    });
    if (action === 'add')
      (getConfig as jest.Mock).mockResolvedValue({ LiveConfig: [] });
    (refreshLiveChannels as jest.Mock).mockRejectedValueOnce(error);
    const response = await livePost(request({ ...liveBody, action }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: '未获取到频道列表，请检查直播源地址',
    });
    expect(console.error).toHaveBeenCalledWith(expect.any(String), error);
    expect(saveConfig).not.toHaveBeenCalled();
  },
);

it.each([
  ['source', '直播源地址无效'],
  ['epg', '节目单地址无效'],
  ['empty', '未获取到频道列表，请检查直播源地址'],
])('preserves explicit live validation feedback: %s', async (kind, message) => {
  if (kind === 'source')
    (validateProxyUrlForRequest as jest.Mock).mockResolvedValueOnce({
      ok: false,
    });
  if (kind === 'epg')
    (validateProxyUrlForRequest as jest.Mock)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false });
  if (kind === 'empty')
    (refreshLiveChannels as jest.Mock).mockResolvedValueOnce(0);
  const response = await livePost(
    request({ ...liveBody, epg: 'https://example.com/epg' }),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: message });
});

it('preserves configuration conflict responses', async () => {
  (saveConfig as jest.Mock).mockRejectedValueOnce(new ConfigConflictError());
  const response = await livePost(request(liveBody));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: '配置已更新，请刷新后重试' });
});
