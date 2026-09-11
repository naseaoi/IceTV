/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

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
    expect(failure.status).toBe(404);

    const retry = await GET(request);
    expect(retry.status).toBe(200);
    expect(mockFetchWithUrlGuard).toHaveBeenCalledTimes(2);
  });
});
