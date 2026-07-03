/** @jest-environment node */

import { webcrypto } from 'crypto';

import { generateSignature } from '../auth.server';
import { appendProxySignature, verifyProxySignature } from '../proxy-auth';

const AUTH_SECRET = 'auth-secret-with-at-least-32-chars';

Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
});

jest.mock('../env.server', () => ({
  getOwnerPassword: () => 'owner-secret',
}));

describe('proxy auth signatures', () => {
  const originalAuthSecret = process.env.AUTH_SECRET;

  beforeEach(() => {
    process.env.AUTH_SECRET = AUTH_SECRET;
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
});
