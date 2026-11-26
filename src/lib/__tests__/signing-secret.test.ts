/** @jest-environment node */

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';

import { generateSignature } from '../auth.server';
import {
  getAuthSigningSecret,
  verifyAuthSignature,
} from '../signing-secret.server';

const AUTH_SECRET = 'auth-secret-with-at-least-32-chars';

installCryptoPolyfill();

describe('auth signing secret', () => {
  const originalAuthSecret = process.env.AUTH_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AUTH_SECRET;
  });

  afterEach(() => {
    jest.restoreAllMocks();

    if (originalAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalAuthSecret;
    }
  });

  it('requires an independent auth secret for new signatures', () => {
    expect(() => getAuthSigningSecret()).toThrow('AUTH_SECRET');
  });

  it('rejects weak auth secrets', () => {
    process.env.AUTH_SECRET = 'short-secret';

    expect(() => getAuthSigningSecret()).toThrow('长度不能少于 32 个字符');
  });

  it('verifies signatures created with AUTH_SECRET', async () => {
    process.env.AUTH_SECRET = AUTH_SECRET;
    const data = 'user:1777777777777';
    const signature = await generateSignature(data, AUTH_SECRET);

    await expect(verifyAuthSignature(data, signature)).resolves.toBe(true);
  });

  it.each([AUTH_SECRET, undefined])(
    'rejects signatures made with another secret when AUTH_SECRET is %s',
    async (secret) => {
      if (secret) process.env.AUTH_SECRET = secret;
      const data = 'user:1777777777777';
      const signature = await generateSignature(data, 'owner-secret');

      await expect(verifyAuthSignature(data, signature)).resolves.toBe(false);
    },
  );

  it('trims AUTH_SECRET before signing and verification', async () => {
    process.env.AUTH_SECRET = `  ${AUTH_SECRET}  `;
    expect(getAuthSigningSecret()).toBe(AUTH_SECRET);
    const signature = await generateSignature('data', AUTH_SECRET);
    await expect(verifyAuthSignature('data', signature)).resolves.toBe(true);
  });
});
