/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import { UrlValidationError } from '@/lib/url-guard';

installWebPolyfills();

const mockFetch = jest.fn();
const mockProxyUrl = jest.fn();
const mockProxyFetch = jest.fn();
const mockConfig = jest.fn();

jest.mock('@/lib/config', () => ({
  getConfigForRead: () => mockConfig(),
}));
jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: (...args: unknown[]) => mockFetch(...args),
  UrlValidationError: class extends Error {},
}));
jest.mock('@/lib/http-proxy-json', () => ({
  getProxyUrlForTarget: () => mockProxyUrl(),
  fetchStreamThroughProxy: (...args: unknown[]) => mockProxyFetch(...args),
}));

const { GET, HEAD } = require('./route') as typeof import('./route');
const request = {} as NextRequest;
const context = {
  params: Promise.resolve({ path: ['l', 'ab', 'cd', '1.jpg'] }),
};

beforeEach(() => {
  jest.resetAllMocks();
  mockConfig.mockResolvedValue({ SiteConfig: {} });
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({
      'content-type': 'image/jpeg',
      'content-length': '128',
      etag: 'cover-v1',
    }),
    body: null,
  });
});

it('HEAD 无正文时返回 200 并保留图片缓存头', async () => {
  const response = await HEAD(request, context);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('');
  expect(response.headers.get('content-type')).toBe('image/jpeg');
  expect(response.headers.get('content-length')).toBe('128');
  expect(response.headers.get('etag')).toBe('cover-v1');
  expect(response.headers.get('cache-control')).toContain('public');
  expect(mockFetch).toHaveBeenCalledWith(
    'https://lain.bgm.tv/pic/cover/l/ab/cd/1.jpg',
    expect.objectContaining({ method: 'HEAD' }),
  );
});

it('代理模式 HEAD 取消兼容 GET 正文并返回 200', async () => {
  const cancel = jest.fn().mockResolvedValue(undefined);
  mockProxyUrl.mockReturnValue(new URL('http://proxy.example:8080'));
  mockProxyFetch.mockResolvedValue({
    status: 200,
    headers: new Headers({ 'content-type': 'image/jpeg' }),
    body: { cancel },
  });
  const response = await HEAD(request, context);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('');
  expect(cancel).toHaveBeenCalled();
});

it('GET 无正文返回 502', async () => {
  expect((await GET(request, context)).status).toBe(502);
});

it('上游非成功响应取消正文并返回 502', async () => {
  const cancel = jest.fn().mockResolvedValue(undefined);
  mockFetch.mockResolvedValue({ ok: false, status: 404, body: { cancel } });
  expect((await GET(request, context)).status).toBe(502);
  expect(cancel).toHaveBeenCalled();
});

it('非图片响应返回 502', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    headers: new Headers({ 'content-type': 'text/html' }),
    body: null,
  });
  expect((await HEAD(request, context)).status).toBe(502);
});

it.each([
  [new Error('timeout'), 504],
  [new TypeError('fetch failed'), 502],
  [new UrlValidationError('Blocked destination'), 403],
  [new ResourceLimitError(), 503],
  [new Error('private token=secret'), 502],
])('直连错误 %s 返回 %s', async (error, status) => {
  mockFetch.mockRejectedValueOnce(error);
  const response = await HEAD(request, context);
  expect(response.status).toBe(status);
  expect(JSON.stringify(await response.json())).not.toContain('secret');
});

it.each([
  [new Error('timeout'), 504],
  [new TypeError('fetch failed'), 502],
  [new Error('代理请求失败: 403'), 502],
])('代理错误 %s 返回 %s', async (error, status) => {
  mockProxyUrl.mockReturnValue(new URL('http://proxy.example:8080'));
  mockProxyFetch.mockRejectedValueOnce(error);
  expect((await HEAD(request, context)).status).toBe(status);
});

it('内部配置读取失败不归为上游错误', async () => {
  mockConfig.mockRejectedValueOnce(new Error('config down'));
  await expect(HEAD(request, context)).rejects.toThrow('config down');
  expect(mockFetch).not.toHaveBeenCalled();
});
