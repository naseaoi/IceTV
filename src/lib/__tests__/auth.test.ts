import { TextEncoder } from 'util';

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';

import {
  generateSignature,
  getSessionExpiresAt,
  parseAuthCookieValue,
  verifySignature,
} from '../auth.server';

if (!global.TextEncoder) {
  global.TextEncoder = TextEncoder as typeof global.TextEncoder;
}
installCryptoPolyfill();

describe('getSessionExpiresAt', () => {
  const originalTtl = process.env.AUTH_SESSION_TTL_HOURS;
  const now = Date.parse('2026-01-01T00:00:00.000Z');

  afterEach(() => {
    if (originalTtl === undefined) {
      delete process.env.AUTH_SESSION_TTL_HOURS;
    } else {
      process.env.AUTH_SESSION_TTL_HOURS = originalTtl;
    }
    jest.restoreAllMocks();
  });

  it('uses a 7 day default ttl', () => {
    delete process.env.AUTH_SESSION_TTL_HOURS;

    expect(getSessionExpiresAt(now)).toBe(now + 7 * 24 * 60 * 60 * 1000);
  });

  it('uses the default ttl when configured ttl is not positive', () => {
    process.env.AUTH_SESSION_TTL_HOURS = '0';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(getSessionExpiresAt(now)).toBe(now + 7 * 24 * 60 * 60 * 1000);
    expect(warnSpy).toHaveBeenCalledWith(
      'AUTH_SESSION_TTL_HOURS 无效，使用默认会话时长',
    );
  });
});

describe('auth cookie parsing', () => {
  it('parses encoded account auth cookies', () => {
    const payload = {
      username: 'demo-user',
      expiresAt: 123456,
      signature: 'signature',
      sessionType: 'account',
    };

    expect(
      parseAuthCookieValue(encodeURIComponent(JSON.stringify(payload))),
    ).toEqual(payload);
  });

  it('returns null for invalid auth cookies', () => {
    expect(parseAuthCookieValue('%E0%A4%A')).toBeNull();
    expect(parseAuthCookieValue('not-json')).toBeNull();
  });
});

describe('auth signatures', () => {
  it('verifies generated signatures', async () => {
    const signature = await generateSignature('payload', 'secret');

    await expect(verifySignature('payload', signature, 'secret')).resolves.toBe(
      true,
    );
    await expect(
      verifySignature('payload', signature.replace(/^./, '0'), 'secret'),
    ).resolves.toBe(false);
    await expect(verifySignature('payload', signature, 'other')).resolves.toBe(
      false,
    );
  });
});
