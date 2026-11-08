/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';

installStreamPolyfills();
const mockFetch = jest.fn();
const mockConfig = jest.fn();
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
});

it('失败源取消正文，成功源输出结果和完成事件', async () => {
  const cancel = jest.fn().mockRejectedValue(new Error('cancel failed'));
  mockFetch.mockResolvedValueOnce({ ok: false, status: 503, body: { cancel } });
  mockFetch.mockImplementation(
    async () =>
      new Response(JSON.stringify({ list: [{ vod_name: 'test movie' }] })),
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
});

it('空源列表正常结束 SSE', async () => {
  mockConfig.mockResolvedValue({ SourceConfig: [] });
  expect(await (await GET(request())).text()).toContain('"completedSources":0');
});
