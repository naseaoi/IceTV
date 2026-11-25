/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { ResourceLimitError } from '@/lib/server-resource-errors';

installStreamPolyfills();
const mockFetch = jest.fn();
const mockConfig = jest.fn();
const mockRecord = jest.fn();
const mockFlushHealth = jest.fn();
jest.mock('@/lib/source-health.server', () => ({
  recordSourceSearchOutcome: (...args: unknown[]) => mockRecord(...args),
  flushSourceHealthSearch: () => mockFlushHealth(),
}));
jest.mock('@/lib/api-auth', () => ({
  isGuardFailure: () => false,
  requireAdmin: async () => ({ username: 'admin' }),
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: () => mockConfig(),
  API_CONFIG: { search: { headers: {} } },
}));
jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('@/lib/upstream-fetch.server', () => ({
  fetchUpstream: (...args: unknown[]) => mockFetch(...args),
}));
const { GET } = require('./route') as typeof import('./route');

function request(signal = new AbortController().signal) {
  return {
    url: 'http://localhost/api/admin/source/validate?q=test',
    signal,
  } as NextRequest;
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
beforeEach(() => {
  jest.clearAllMocks();
  mockFlushHealth.mockResolvedValue(undefined);
  mockConfig.mockResolvedValue({
    SourceConfig: Array.from({ length: 5 }, (_, i) => ({
      key: String(i),
      name: String(i),
      api: `https://example.com/${i}`,
    })),
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it.each(['cancel', 'abort'])('%s 中止在途请求并停止排队源', async (mode) => {
  const signals: AbortSignal[] = [];
  mockFetch.mockImplementation(
    (_url: string, { signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        }),
      );
    },
  );
  const abort = new AbortController();
  const response = await GET(request(abort.signal));
  await flush();
  expect(signals).toHaveLength(3);
  if (mode === 'cancel') await response.body!.cancel();
  else abort.abort();
  await flush();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(3);
  expect(mockRecord).not.toHaveBeenCalled();
  expect(mockFlushHealth).toHaveBeenCalledTimes(1);
});

it('失败源取消正文，成功源输出结果和完成事件', async () => {
  const cancel = jest.fn().mockRejectedValue(new Error('cancel failed'));
  mockFetch.mockResolvedValueOnce({ ok: false, status: 503, body: { cancel } });
  mockFetch.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ list: [{ vod_id: 1, vod_name: 'test movie' }] }),
      ),
  );
  const text = await (await GET(request())).text();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(text).toContain('"type":"source_error"');
  expect(text).toContain('"status":"valid"');
  expect(text).toContain('"completedSources":5');
});

it('总超时持续覆盖响应体读取', async () => {
  jest.useFakeTimers();
  mockConfig.mockResolvedValue({
    SourceConfig: [{ key: 'one', api: 'https://example.com' }],
  });
  let upstreamSignal: AbortSignal | undefined;
  mockFetch.mockImplementation(
    async (_url: string, { signal }: { signal: AbortSignal }) => {
      upstreamSignal = signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            signal.addEventListener(
              'abort',
              () => controller.error(signal.reason),
              { once: true },
            );
          },
        }),
      );
    },
  );
  const response = await GET(request());
  await flush();
  expect(upstreamSignal?.aborted).toBe(false);
  jest.advanceTimersByTime(10_000);
  expect(upstreamSignal?.aborted).toBe(true);
  expect(await response.text()).toContain('"type":"complete"');
  expect(mockRecord).toHaveBeenCalledWith('one', 'error', 10_000);
});

it('空源列表正常结束 SSE', async () => {
  mockConfig.mockResolvedValue({ SourceConfig: [] });
  expect(await (await GET(request())).text()).toContain('"completedSources":0');
});

it.each([
  ['有效结果', { list: [{ vod_id: 1, vod_name: 'test movie' }] }, 'ok'],
  ['空结果', { list: [] }, 'empty'],
  ['无匹配标题', { list: [{ vod_id: 1, vod_name: 'other' }] }, 'empty'],
  [
    '混合脏条目',
    { list: [null, { vod_name: 'test' }, { vod_id: 1, vod_name: 'test' }] },
    'ok',
  ],
  ['全部脏条目', { list: [null, { vod_name: 'test' }] }, 'error'],
  ['无效结构', { list: null }, 'error'],
  ['搜索未开放', { code: 1002, list: [] }, 'error'],
])('%s 写入对应健康样本', async (_label, data, outcome) => {
  mockConfig.mockResolvedValue({
    SourceConfig: [{ key: 'one', api: 'https://example.com' }],
  });
  mockFetch.mockResolvedValue(new Response(JSON.stringify(data)));
  const body = await (await GET(request())).text();
  expect(body).toContain(
    `"status":"${outcome === 'error' ? 'invalid' : outcome === 'empty' ? 'no_results' : 'valid'}"`,
  );
  expect(mockRecord).toHaveBeenCalledWith('one', outcome, expect.any(Number));
  expect(mockFlushHealth).toHaveBeenCalledTimes(1);
});
it.each([
  ['请求失败', new Error('network'), true],
  ['资源限额', new ResourceLimitError(), false],
])('%s 的健康采样', async (_label, error, recorded) => {
  mockConfig.mockResolvedValue({
    SourceConfig: [{ key: 'one', api: 'https://example.com' }],
  });
  mockFetch.mockRejectedValue(error);
  await (await GET(request())).text();
  expect(mockRecord).toHaveBeenCalledTimes(recorded ? 1 : 0);
  if (recorded)
    expect(mockRecord).toHaveBeenCalledWith('one', 'error', expect.any(Number));
});
it('JSON 解析失败记录错误，刷新失败只记录日志', async () => {
  mockConfig.mockResolvedValue({
    SourceConfig: [{ key: 'one', api: 'https://example.com' }],
  });
  mockFetch.mockResolvedValue(new Response('bad json'));
  mockFlushHealth.mockRejectedValue(new Error('db unavailable'));
  expect(await (await GET(request())).text()).toContain('"type":"complete"');
  expect(mockRecord).toHaveBeenCalledWith('one', 'error', expect.any(Number));
  expect(console.warn).toHaveBeenCalledWith(
    '刷新源健康数据失败:',
    expect.any(Error),
  );
});
it('特殊源同样写入健康样本', async () => {
  mockConfig.mockResolvedValue({
    SourceConfig: [{ key: 'giri', api: 'https://girigirilove.com' }],
  });
  mockFetch.mockResolvedValue(new Response(JSON.stringify({ list: [] })));
  expect(await (await GET(request())).text()).toContain(
    '"status":"no_results"',
  );
  expect(mockRecord).toHaveBeenCalledWith('giri', 'empty', expect.any(Number));
});

it('西瓜卡通按网页搜索检测，区分有效、无匹配与页面异常', async () => {
  mockConfig.mockResolvedValue({
    SourceConfig: [
      { key: 'xigua', name: '西瓜卡通', api: 'https://www.xgcartoon.com' },
    ],
  });
  const html =
    '<a href="/detail/test" class="topic-list-item"><div class="h3">test anime</div></a>';
  for (const [body, status] of [
    [html, 'valid'],
    ['共 0 条搜索结果', 'no_results'],
    ['<html>Just a moment...</html>', 'invalid'],
  ]) {
    mockFetch.mockResolvedValue(new Response(body));
    const result = await (await GET(request())).text();
    expect(result).toContain(`"status":"${status}"`);
  }
  expect(
    mockFetch.mock.calls.every(
      ([url]) => url === 'https://www.xgcartoon.com/search?q=test',
    ),
  ).toBe(true);
  expect(
    mockRecord.mock.calls.map(([source, outcome]) => [source, outcome]),
  ).toEqual([
    ['xigua', 'ok'],
    ['xigua', 'empty'],
    ['xigua', 'error'],
  ]);
});
