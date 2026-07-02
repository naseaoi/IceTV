/** @jest-environment node */

import { webcrypto } from 'crypto';

import { generateSignature } from '../auth.server';
import { getOwnerPassword } from '../env.server';
import {
  getAuthSigningSecret,
  verifyAuthSignature,
} from '../signing-secret.server';

Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
});

jest.mock('../env.server', () => ({
  getOwnerPassword: jest.fn(),
}));

describe('auth signing secret', () => {
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalIcetvAuthSecret = process.env.ICETV_AUTH_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AUTH_SECRET;
    delete process.env.ICETV_AUTH_SECRET;
    (getOwnerPassword as jest.Mock).mockReturnValue('owner-secret');
  });

  afterEach(() => {
    if (originalAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalAuthSecret;
    }

    if (originalIcetvAuthSecret === undefined) {
      delete process.env.ICETV_AUTH_SECRET;
    } else {
      process.env.ICETV_AUTH_SECRET = originalIcetvAuthSecret;
    }
  });

  it('requires an independent auth secret for new signatures', () => {
    expect(() => getAuthSigningSecret()).toThrow('AUTH_SECRET');
  });

  it('verifies signatures created with AUTH_SECRET', async () => {
    process.env.AUTH_SECRET = 'auth-secret';
    const data = 'user:1777777777777';
    const signature = await generateSignature(data, 'auth-secret');

    await expect(verifyAuthSignature(data, signature)).resolves.toBe(true);
  });

  it('accepts legacy owner-password sessions only when migration is allowed', async () => {
    process.env.AUTH_SECRET = 'auth-secret';
    const data = 'user:1777777777777';
    const legacySignature = await generateSignature(data, 'owner-secret');

    await expect(verifyAuthSignature(data, legacySignature)).resolves.toBe(
      false,
    );
    await expect(
      verifyAuthSignature(data, legacySignature, {
        allowLegacyOwnerPassword: true,
      }),
    ).resolves.toBe(true);
  });
});
