/** @jest-environment node */

import { webcrypto } from 'crypto';

import { appendProxySignature, verifyProxySignature } from '../proxy-auth';

Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
});

jest.mock('../env.server', () => ({
  getOwnerPassword: () => 'owner-secret',
}));

describe('proxy auth signatures', () => {
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
});
