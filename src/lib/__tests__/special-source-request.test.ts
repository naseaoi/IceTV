/** @jest-environment node */

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import type { ApiSite } from '@/lib/config';
import {
  requestSourceJson,
  requestSourceText,
} from '@/lib/downstream-sources/request.server';
import { matchesSiteHost } from '@/lib/downstream-sources/shared';
import { ResourceLimitError } from '@/lib/server-resource-errors';

installStreamPolyfills();
const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

function site(api: string): ApiSite {
  return { key: 'k', name: 'n', api };
}

it('主机名识别只看 API 主机，含子域名，不匹配路径与查询参数', () => {
  expect(matchesSiteHost(site('https://example.com'), 'example.com')).toBe(
    true,
  );
  expect(
    matchesSiteHost(site('https://www.Example.com/x'), 'example.com'),
  ).toBe(true);
  expect(matchesSiteHost(site('https://notexample.com'), 'example.com')).toBe(
    false,
  );
  expect(
    matchesSiteHost(
      site('https://cms.test/api.php?from=example.com'),
      'example.com',
    ),
  ).toBe(false);
  expect(matchesSiteHost(site('not a url'), 'example.com')).toBe(false);
});

it('成功时返回正文与最终地址', async () => {
  (global.fetch as jest.Mock).mockResolvedValue(new Response('<html>'));
  await expect(
    requestSourceText('示例', 'https://example.com/a'),
  ).resolves.toEqual({ text: '<html>', finalUrl: 'https://example.com/a' });

  (global.fetch as jest.Mock).mockResolvedValue(
    new Response(JSON.stringify({ ok: 1 })),
  );
  await expect(
    requestSourceJson('示例', 'https://example.com/b'),
  ).resolves.toEqual({ ok: 1 });
});

it('非 2xx 取消正文并保留状态码', async () => {
  const cancel = jest.fn().mockResolvedValue(undefined);
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: false,
    status: 503,
    body: { cancel },
  });
  await expect(
    requestSourceText('示例', 'https://example.com/a'),
  ).rejects.toThrow('示例请求失败 (503)');
  expect(cancel).toHaveBeenCalled();
});

it('底层错误只暴露错误类型，ResourceLimitError 原样抛出', async () => {
  (global.fetch as jest.Mock).mockRejectedValue(
    Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNRESET' },
    }),
  );
  await expect(
    requestSourceText('示例', 'https://example.com/a?wd=secret'),
  ).rejects.toThrow('示例请求失败 (TypeError:ECONNRESET)');

  const limit = new ResourceLimitError();
  (global.fetch as jest.Mock).mockRejectedValue(limit);
  await expect(requestSourceText('示例', 'https://example.com/a')).rejects.toBe(
    limit,
  );
});

it('超时与父级取消区分', async () => {
  jest.useFakeTimers();
  (global.fetch as jest.Mock).mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason),
        );
      }),
  );
  const timed = requestSourceText('示例', 'https://example.com/a', {
    timeoutMs: 50,
  });
  const timedAssertion = expect(timed).rejects.toThrow('示例请求超时');
  jest.advanceTimersByTime(50);
  await timedAssertion;

  const parent = new AbortController();
  const reason = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const cancelled = requestSourceText('示例', 'https://example.com/a', {
    signal: parent.signal,
  });
  parent.abort(reason);
  await expect(cancelled).rejects.toBe(reason);
});
