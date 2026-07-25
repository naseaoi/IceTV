/** @jest-environment node */

import { webcrypto } from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';

import { generateSignature } from '../auth.server';
import {
  appendProxySignature,
  resolveProxyAuthorization,
  verifyProxySignature,
} from '../proxy-auth';

const AUTH_SECRET = 'auth-secret-with-at-least-32-chars';
const mockRequireActiveUser = jest.fn();

Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
});

jest.mock('../env.server', () => ({
  getOwnerPassword: () => 'owner-secret',
}));

jest.mock('@/lib/api-auth', () => ({
  isGuardFailure: (result: object) => 'response' in result,
  requireActiveUser: (...args: unknown[]) => mockRequireActiveUser(...args),
}));

describe('proxy auth signatures', () => {
  const originalAuthSecret = process.env.AUTH_SECRET;

  beforeEach(() => {
    process.env.AUTH_SECRET = AUTH_SECRET;
    mockRequireActiveUser.mockReset();
  });

  afterEach(() => {
    if (originalAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalAuthSecret;
    }
  });

  it('accepts a valid signature for the same purpose and target', async () => {
    const targetUrl = 'https://example.com/live/segment.ts';
    const params = new URLSearchParams({ url: targetUrl });

    await appendProxySignature(params, 'segment', targetUrl);

    await expect(
      verifyProxySignature(params, 'segment', targetUrl),
    ).resolves.toBe(true);
  });

  it('rejects purpose mismatch and expired signatures', async () => {
    const targetUrl = 'https://example.com/live/key.bin';
    const params = new URLSearchParams({ url: targetUrl });

    await appendProxySignature(params, 'key', targetUrl);

    await expect(
      verifyProxySignature(params, 'segment', targetUrl),
    ).resolves.toBe(false);

    params.set('icetv-expires', String(Date.now() - 1));
    await expect(verifyProxySignature(params, 'key', targetUrl)).resolves.toBe(
      false,
    );
  });

  it('rejects signatures created with the owner password', async () => {
    const targetUrl = 'https://example.com/live/segment.ts';
    const expiresAt = Date.now() + 60_000;
    const signature = await generateSignature(
      JSON.stringify(['segment', targetUrl, expiresAt]),
      'owner-secret',
    );
    const params = new URLSearchParams({
      url: targetUrl,
      'icetv-expires': String(expiresAt),
      'icetv-signature': signature,
    });

    await expect(
      verifyProxySignature(params, 'segment', targetUrl),
    ).resolves.toBe(false);
  });

  it('签名请求不再重复校验会话', async () => {
    const targetUrl = 'https://example.com/poster.jpg';
    const params = new URLSearchParams({ url: targetUrl });
    await appendProxySignature(params, 'image', targetUrl);
    const request = {
      url: `http://localhost/api/image-proxy?${params.toString()}`,
    } as NextRequest;

    await expect(
      resolveProxyAuthorization(request, 'image', targetUrl),
    ).resolves.toEqual({ authorized: true, via: 'signature' });
    expect(mockRequireActiveUser).not.toHaveBeenCalled();
  });

  it('未签名请求仍需完整会话校验并复用用户名', async () => {
    const targetUrl = 'https://example.com/poster.jpg';
    const request = {
      url: `http://localhost/api/image-proxy?url=${encodeURIComponent(targetUrl)}`,
    } as NextRequest;
    mockRequireActiveUser.mockResolvedValue({
      username: 'demo-user',
      isOwner: false,
      role: 'user',
    });

    await expect(
      resolveProxyAuthorization(request, 'image', targetUrl),
    ).resolves.toEqual({
      authorized: true,
      via: 'session',
      username: 'demo-user',
    });
    expect(mockRequireActiveUser).toHaveBeenCalledWith(request, {
      unauthorizedMessage: 'Unauthorized',
      includeUserStateCode: false,
    });
  });

  it('未签名且无有效会话时保持拒绝访问', async () => {
    const targetUrl = 'https://example.com/poster.jpg';
    const response = { status: 401 } as NextResponse;
    const request = {
      url: `http://localhost/api/image-proxy?url=${encodeURIComponent(targetUrl)}`,
    } as NextRequest;
    mockRequireActiveUser.mockResolvedValue({ response });

    const result = await resolveProxyAuthorization(request, 'image', targetUrl);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response).toBe(response);
    }
  });
});
