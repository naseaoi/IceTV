/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import { UrlValidationError } from '@/lib/url-guard';

installWebPolyfills();

const mockResolveProxyAuthorization = jest.fn();
const mockRequireServerProxyQuota = jest.fn();
const mockValidateProxyUrlForRequest = jest.fn();
const mockFetchWithUrlGuard = jest.fn();
const mockReadArrayBufferLimited = jest.fn();
const mockResizeCoverImage = jest.fn();
const mockGetConfigForRead = jest.fn();

jest.mock('@/lib/proxy-auth', () => ({
  resolveProxyAuthorization: (...args: unknown[]) =>
    mockResolveProxyAuthorization(...args),
}));

jest.mock('@/lib/config', () => ({
  getConfigForRead: (...args: unknown[]) => mockGetConfigForRead(...args),
}));

jest.mock('@/lib/server-proxy-guard', () => ({
  recordServerProxyFailure: jest.fn(),
  requireServerProxyQuota: (...args: unknown[]) =>
    mockRequireServerProxyQuota(...args),
}));

jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: (...args: unknown[]) => mockFetchWithUrlGuard(...args),
  UrlValidationError: class UrlValidationError extends Error {},
  validateProxyUrlForRequest: (...args: unknown[]) =>
    mockValidateProxyUrlForRequest(...args),
}));

jest.mock('@/lib/proxy-response-limits', () => ({
  assertContentLength: jest.fn(),
  createLimitedReadableStream: jest.fn(),
  readArrayBufferLimited: (...args: unknown[]) =>
    mockReadArrayBufferLimited(...args),
  ResponseSizeLimitError: class ResponseSizeLimitError extends Error {},
}));

jest.mock('@/lib/cover-image-resize', () => ({
  ...jest.requireActual('@/lib/cover-image-resize'),
  resizeCoverImage: (...args: unknown[]) => mockResizeCoverImage(...args),
}));

const { GET } = require('./route') as typeof import('./route');
const { clearResizedCoverCacheForTests } =
  require('@/lib/cover-image-resize-cache.server') as typeof import('@/lib/cover-image-resize-cache.server');

describe('image proxy route auth order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearResizedCoverCacheForTests();
    mockRequireServerProxyQuota.mockReturnValue(null);
    mockGetConfigForRead.mockResolvedValue({ SiteConfig: {} });
  });

  it('authorizes before validating the target URL', async () => {
    const authFailure = Response.json(
      { error: 'Unauthorized' },
      { status: 401 },
    );
    mockResolveProxyAuthorization.mockResolvedValue({
      authorized: false,
      response: authFailure,
    });

    const request = {
      url: 'http://localhost/api/image-proxy?url=http://metadata.local/a.jpg',
    } as NextRequest;
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(mockResolveProxyAuthorization).toHaveBeenCalledWith(
      request,
      'image',
      'http://metadata.local/a.jpg',
    );
    expect(mockValidateProxyUrlForRequest).not.toHaveBeenCalled();
  });

  it('rejects unsupported image widths after authorization', async () => {
    mockResolveProxyAuthorization.mockResolvedValue({
      authorized: true,
      via: 'signature',
    });

    const request = {
      url: 'http://localhost/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fa.jpg&width=123',
    } as NextRequest;
    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(mockValidateProxyUrlForRequest).not.toHaveBeenCalled();
  });

  it('签名请求不再重复解析会话并按 IP 限流', async () => {
    mockResolveProxyAuthorization.mockResolvedValue({
      authorized: true,
      via: 'signature',
    });
    mockValidateProxyUrlForRequest.mockResolvedValue({
      ok: true,
      url: 'https://example.com/a.jpg',
    });
    mockRequireServerProxyQuota.mockReturnValue(
      Response.json({ error: 'Too Many Requests' }, { status: 429 }),
    );
    const request = {
      url: 'http://localhost/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fa.jpg',
    } as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(429);
    expect(mockRequireServerProxyQuota).toHaveBeenCalledWith(
      'douban-image',
      request,
      undefined,
    );
  });

  it('未签名请求复用已校验的会话用户名限流', async () => {
    mockResolveProxyAuthorization.mockResolvedValue({
      authorized: true,
      via: 'session',
      username: 'demo-user',
    });
    mockValidateProxyUrlForRequest.mockResolvedValue({
      ok: true,
      url: 'https://example.com/a.jpg',
    });
    mockRequireServerProxyQuota.mockReturnValue(
      Response.json({ error: 'Too Many Requests' }, { status: 429 }),
    );
    const request = {
      url: 'http://localhost/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fa.jpg',
    } as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(429);
    expect(mockRequireServerProxyQuota).toHaveBeenCalledWith(
      'douban-image',
      request,
      'demo-user',
    );
  });
});

describe('image proxy resize cache', () => {
  const RESIZE_URL =
    'http://localhost/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fa.jpg&width=180&quality=72';

  beforeEach(() => {
    jest.clearAllMocks();
    clearResizedCoverCacheForTests();
    mockRequireServerProxyQuota.mockReturnValue(null);
    mockResolveProxyAuthorization.mockResolvedValue({
      authorized: true,
      via: 'signature',
    });
    mockValidateProxyUrlForRequest.mockResolvedValue({
      ok: true,
      url: 'https://example.com/a.jpg',
    });
    mockFetchWithUrlGuard.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      body: { cancel: jest.fn().mockResolvedValue(undefined) },
    });
    mockReadArrayBufferLimited.mockResolvedValue(new ArrayBuffer(64));
    mockResizeCoverImage.mockResolvedValue(new ArrayBuffer(16));
    mockGetConfigForRead.mockResolvedValue({
      SiteConfig: { ImageProxyTimeoutSeconds: 42 },
    });
  });

  it('第二次相同缩放请求命中缓存且不再回源', async () => {
    const request = { url: RESIZE_URL } as NextRequest;

    const first = await GET(request);
    const second = await GET(request);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('image/webp');
    expect(second.headers.get('content-type')).toBe('image/webp');
    expect(second.headers.get('content-length')).toBe('16');
    expect(mockFetchWithUrlGuard).toHaveBeenCalledTimes(1);
    expect(mockResizeCoverImage).toHaveBeenCalledTimes(1);
  });

  it('缓存命中仍先鉴权、校验 URL 并计入限流', async () => {
    const request = { url: RESIZE_URL } as NextRequest;
    await GET(request);
    jest.clearAllMocks();
    mockRequireServerProxyQuota.mockReturnValue(
      Response.json({ error: 'Too Many Requests' }, { status: 429 }),
    );

    const response = await GET(request);

    expect(response.status).toBe(429);
    expect(mockResolveProxyAuthorization).toHaveBeenCalledTimes(1);
    expect(mockValidateProxyUrlForRequest).toHaveBeenCalledTimes(1);
  });

  it('不同宽度不共用缓存条目', async () => {
    await GET({ url: RESIZE_URL } as NextRequest);
    await GET({
      url: 'http://localhost/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fa.jpg&width=320&quality=72',
    } as NextRequest);

    expect(mockFetchWithUrlGuard).toHaveBeenCalledTimes(2);
    expect(mockResizeCoverImage).toHaveBeenCalledTimes(2);
  });

  it('回源带上配置的图片代理超时', async () => {
    await GET({ url: RESIZE_URL } as NextRequest);

    expect(mockFetchWithUrlGuard).toHaveBeenCalledWith(
      'https://example.com/a.jpg',
      expect.objectContaining({ timeoutMs: 42_000 }),
    );
  });

  it('回源失败不写入缓存', async () => {
    mockFetchWithUrlGuard.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers(),
    });
    const request = { url: RESIZE_URL } as NextRequest;

    const failure = await GET(request);
    expect(failure.status).toBe(502);

    const retry = await GET(request);
    expect(retry.status).toBe(200);
    expect(mockFetchWithUrlGuard).toHaveBeenCalledTimes(2);
  });
});

it('does not return an upstream statusText to the client', async () => {
  mockResolveProxyAuthorization.mockResolvedValue({
    authorized: true,
    via: 'signature',
  });
  mockRequireServerProxyQuota.mockReturnValue(null);
  mockGetConfigForRead.mockResolvedValue({ SiteConfig: {} });
  mockValidateProxyUrlForRequest.mockResolvedValue({
    ok: true,
    url: 'https://example.com/private.jpg',
  });
  mockFetchWithUrlGuard.mockResolvedValue({
    ok: false,
    status: 502,
    statusText: 'private upstream token=secret',
    body: null,
  });
  const response = await GET({
    url: 'http://localhost/api/image-proxy?url=https://example.com/private.jpg',
  } as NextRequest);
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: '图片获取失败' });
});

describe('图片代理上游错误与 Referer', () => {
  const request = {
    url: 'http://localhost/api/image-proxy?url=https://example.com/a.jpg',
  } as NextRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireServerProxyQuota.mockReturnValue(null);
    mockResolveProxyAuthorization.mockResolvedValue({
      authorized: true,
      via: 'signature',
    });
    mockValidateProxyUrlForRequest.mockResolvedValue({
      ok: true,
      url: 'https://example.com/a.jpg',
    });
    mockGetConfigForRead.mockResolvedValue({ SiteConfig: {} });
    mockFetchWithUrlGuard.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      body: { cancel: jest.fn().mockResolvedValue(undefined) },
    });
  });

  it.each([
    [new Error('timeout'), 504],
    [new TypeError('fetch failed'), 502],
    [new Error('private token=secret'), 502],
    [new UrlValidationError('Blocked destination'), 403],
    [new ResourceLimitError(), 503],
  ])('错误 %s 返回 %s 且隐藏内部信息', async (error, status) => {
    mockFetchWithUrlGuard.mockRejectedValueOnce(error);
    const response = await GET(request);
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });

  it.each([404, 429, 500])('上游 HTTP %s 统一返回 502', async (status) => {
    const cancel = jest.fn().mockResolvedValue(undefined);
    mockFetchWithUrlGuard.mockResolvedValueOnce({
      ok: false,
      status,
      body: { cancel },
    });
    expect((await GET(request)).status).toBe(502);
    expect(cancel).toHaveBeenCalled();
  });

  it('非图片与无正文响应返回 502', async () => {
    mockFetchWithUrlGuard.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      body: null,
    });
    expect((await GET(request)).status).toBe(502);
    mockFetchWithUrlGuard.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      body: null,
    });
    expect((await GET(request)).status).toBe(502);
  });

  it('初始 URL 校验拒绝仍返回 403', async () => {
    mockValidateProxyUrlForRequest.mockResolvedValueOnce({
      ok: false,
      reason: 'Blocked destination',
    });
    expect((await GET(request)).status).toBe(403);
    expect(mockFetchWithUrlGuard).not.toHaveBeenCalled();
  });

  it('内部配置读取失败不归为上游错误', async () => {
    mockGetConfigForRead.mockRejectedValueOnce(new Error('config down'));
    await expect(GET(request)).rejects.toThrow('config down');
    expect(mockFetchWithUrlGuard).not.toHaveBeenCalled();
  });

  it.each([
    ['https://doubanio.com/a.jpg', 'https://movie.douban.com/'],
    ['https://img1.doubanio.com/a.jpg', 'https://movie.douban.com/'],
    ['https://example.com:8443/a.jpg', 'https://example.com:8443/'],
    ['https://evildoubanio.com/a.jpg', 'https://evildoubanio.com/'],
    [
      'https://doubanio.com.example.com/a.jpg',
      'https://doubanio.com.example.com/',
    ],
  ])('%s 使用 Referer %s', async (url, referer) => {
    mockValidateProxyUrlForRequest.mockResolvedValueOnce({ ok: true, url });
    expect((await GET(request)).status).toBe(200);
    expect(mockFetchWithUrlGuard).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        headers: expect.objectContaining({ Referer: referer }),
      }),
    );
  });
});
