/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();

const mockAuthorizeProxyRequest = jest.fn();
const mockValidateProxyUrlForRequest = jest.fn();

jest.mock('@/lib/proxy-auth', () => ({
  authorizeProxyRequest: (...args: unknown[]) =>
    mockAuthorizeProxyRequest(...args),
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
  });

  it('authorizes before validating the target URL', async () => {
    mockAuthorizeProxyRequest.mockResolvedValue(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const request = {
      url: 'http://localhost/api/image-proxy?url=http://metadata.local/a.jpg',
    } as NextRequest;
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(mockAuthorizeProxyRequest).toHaveBeenCalledWith(
      request,
      'image',
      'http://metadata.local/a.jpg',
    );
    expect(mockValidateProxyUrlForRequest).not.toHaveBeenCalled();
  });

  it('rejects unsupported image widths after authorization', async () => {
    mockAuthorizeProxyRequest.mockResolvedValue(null);

    const request = {
      url: 'http://localhost/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fa.jpg&width=123',
    } as NextRequest;
    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(mockValidateProxyUrlForRequest).not.toHaveBeenCalled();
  });
});
