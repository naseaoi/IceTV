/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { db } from '@/lib/db';

installWebPolyfills();

const { requireServerProxyQuota } =
  require('@/lib/server-proxy-guard') as typeof import('@/lib/server-proxy-guard');

function createRequest(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

describe('server proxy quota', () => {
  const originalTrustedProxyCount = process.env.TRUSTED_PROXY_COUNT;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalTrustedProxyCount === undefined) {
      delete process.env.TRUSTED_PROXY_COUNT;
    } else {
      process.env.TRUSTED_PROXY_COUNT = originalTrustedProxyCount;
    }
  });

  it('fails closed when the shared store is unavailable', async () => {
    jest
      .spyOn(db, 'getSharedResourceStore')
      .mockRejectedValue(new Error('database down'));
    const result = await requireServerProxyQuota(
      'vod-m3u8',
      createRequest(),
      'outage',
    );
    expect(result?.status).toBe(503);
    expect(result?.headers.get('Retry-After')).toBeTruthy();
  });

  it('放行额度内的分片请求，超额回 429 且带 Retry-After', async () => {
    const request = createRequest({ 'x-real-ip': '10.0.0.1' });
    const username = `seg-user-${Date.now()}`;

    for (let i = 0; i < 1200; i += 1) {
      expect(
        await requireServerProxyQuota('vod-segment', request, username),
      ).toBeNull();
    }

    const blocked = await requireServerProxyQuota(
      'vod-segment',
      request,
      username,
    );
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get('Retry-After')).toBeTruthy();
  });

  it('清单额度独立于分片额度', async () => {
    const request = createRequest({ 'x-real-ip': '10.0.0.2' });
    const username = `m3u8-user-${Date.now()}`;

    for (let i = 0; i < 240; i += 1) {
      expect(
        await requireServerProxyQuota('vod-m3u8', request, username),
      ).toBeNull();
    }

    expect(
      (await requireServerProxyQuota('vod-m3u8', request, username))?.status,
    ).toBe(429);
    expect(
      await requireServerProxyQuota('vod-segment', request, username),
    ).toBeNull();
  });

  it('未登录按 IP 计数，且尊重 TRUSTED_PROXY_COUNT 取真实客户端段', async () => {
    process.env.TRUSTED_PROXY_COUNT = '1';
    const spoofed = createRequest({
      'x-forwarded-for': '1.1.1.1, 203.0.113.9',
    });

    for (let i = 0; i < 60; i += 1) {
      expect(await requireServerProxyQuota('bangumi-data', spoofed)).toBeNull();
    }
    expect(
      (await requireServerProxyQuota('bangumi-data', spoofed))?.status,
    ).toBe(429);

    // 换伪造的首段但真实段不变，仍应命中同一个桶
    const sameClient = createRequest({
      'x-forwarded-for': '2.2.2.2, 203.0.113.9',
    });
    expect(
      (await requireServerProxyQuota('bangumi-data', sameClient))?.status,
    ).toBe(429);
  });
});
