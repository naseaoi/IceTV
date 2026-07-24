/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();

const mockResolveProxyAuthorization = jest.fn();
const mockRequireServerProxyQuota = jest.fn();
const mockValidateProxyUrlForRequest = jest.fn();

jest.mock('@/lib/proxy-auth', () => ({
  resolveProxyAuthorization: (...args: unknown[]) =>
    mockResolveProxyAuthorization(...args),
}));

jest.mock('@/lib/server-proxy-guard', () => ({
  recordServerProxyFailure: jest.fn(),
  requireServerProxyQuota: (...args: unknown[]) =>
    mockRequireServerProxyQuota(...args),
}));

jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: jest.fn(),
  UrlValidationError: class UrlValidationError extends Error {},
  validateProxyUrlForRequest: (...args: unknown[]) =>
    mockValidateProxyUrlForRequest(...args),
}));

jest.mock('@/lib/proxy-response-limits', () => ({
  assertContentLength: jest.fn(),
  createLimitedReadableStream: jest.fn(),
  ResponseSizeLimitError: class ResponseSizeLimitError extends Error {},
}));

const { GET } = require('./route') as typeof import('./route');

describe('image proxy route auth order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireServerProxyQuota.mockReturnValue(null);
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
