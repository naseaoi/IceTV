/** @jest-environment node */

import { webcrypto } from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';

import {
  generateSignature,
  getSignatureData,
  verifySignature,
} from '@/lib/auth.server';
import { proxy } from '@/proxy';

const AUTH_SECRET = 'auth-secret-with-at-least-32-chars';

Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
});

type CookieCall = {
  name: string;
  value: string;
  options: { expires?: Date };
};

type MockResponse = NextResponse & { cookieCalls: CookieCall[] };

function createMockResponse() {
  const cookieCalls: CookieCall[] = [];
  return {
    cookieCalls,
    cookies: {
      set(name: string, value: string, options: { expires?: Date }) {
        cookieCalls.push({ name, value, options });
      },
    },
  };
}

jest.mock('next/server', () => ({
  NextResponse: {
    next: () => createMockResponse(),
  },
}));

function createRequest(cookieValue?: string): NextRequest {
  return {
    cookies: {
      get: (name: string) =>
        name === 'auth' && cookieValue !== undefined
          ? { name, value: cookieValue }
          : undefined,
      has: () => false,
    },
    nextUrl: { protocol: 'http:' },
    headers: { get: () => null },
  } as unknown as NextRequest;
}

async function buildAuthCookie(
  secret: string,
  expiresAt: number,
): Promise<string> {
  const signature = await generateSignature(
    getSignatureData('account', expiresAt, 'alice'),
    secret,
  );

  return encodeURIComponent(
    JSON.stringify({
      username: 'alice',
      role: 'user',
      signature,
      expiresAt,
      sessionType: 'account',
    }),
  );
}

function parseAuthCookie(value: string): {
  signature: string;
  expiresAt: number;
  username: string;
} {
  return JSON.parse(decodeURIComponent(value));
}

const HOUR_MS = 60 * 60 * 1000;
const ORIGINAL_ENV = {
  AUTH_SECRET: process.env.AUTH_SECRET,
  ICETV_PASSWORD: process.env.ICETV_PASSWORD,
  AUTH_SESSION_TTL_HOURS: process.env.AUTH_SESSION_TTL_HOURS,
  LEGACY_COOKIE_CUTOFF_DATE: process.env.LEGACY_COOKIE_CUTOFF_DATE,
};

describe('proxy middleware session handling', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = AUTH_SECRET;
    process.env.ICETV_PASSWORD = 'owner-pass';
    process.env.LEGACY_COOKIE_CUTOFF_DATE = '2099-01-01T00:00:00.000Z';
    delete process.env.AUTH_SESSION_TTL_HOURS;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    Object.entries(ORIGINAL_ENV).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  it('keeps AUTH_SECRET-signed session without touching cookies', async () => {
    const cookie = await buildAuthCookie(
      AUTH_SECRET,
      Date.now() + 29 * 24 * HOUR_MS,
    );

    const response = (await proxy(createRequest(cookie))) as MockResponse;

    expect(response.cookieCalls).toHaveLength(0);
  });

  it('refreshes near-expiry session with AUTH_SECRET signature', async () => {
    const cookie = await buildAuthCookie(AUTH_SECRET, Date.now() + HOUR_MS);

    const response = (await proxy(createRequest(cookie))) as MockResponse;

    const authCall = response.cookieCalls.find((call) => call.name === 'auth');
    expect(authCall).toBeDefined();
    const refreshed = parseAuthCookie(authCall!.value);
    expect(refreshed.expiresAt).toBeGreaterThan(Date.now() + HOUR_MS);
    await expect(
      verifySignature(
        getSignatureData('account', refreshed.expiresAt, 'alice'),
        refreshed.signature,
        AUTH_SECRET,
      ),
    ).resolves.toBe(true);
  });

  it('migrates legacy owner-password session to AUTH_SECRET on refresh', async () => {
    const cookie = await buildAuthCookie('owner-pass', Date.now() + HOUR_MS);
    const consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const response = (await proxy(createRequest(cookie))) as MockResponse;

    const authCall = response.cookieCalls.find((call) => call.name === 'auth');
    expect(authCall).toBeDefined();
    const refreshed = parseAuthCookie(authCall!.value);
    await expect(
      verifySignature(
        getSignatureData('account', refreshed.expiresAt, 'alice'),
        refreshed.signature,
        AUTH_SECRET,
      ),
    ).resolves.toBe(true);
    await expect(
      verifySignature(
        getSignatureData('account', refreshed.expiresAt, 'alice'),
        refreshed.signature,
        'owner-pass',
      ),
    ).resolves.toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '检测到使用旧站长口令验签的会话，建议尽快让用户重新登录，并用 LEGACY_COOKIE_CUTOFF_DATE 关闭兼容期',
    );
  });

  it('clears cookies when signature is invalid', async () => {
    const expiresAt = Date.now() + HOUR_MS;
    const cookie = encodeURIComponent(
      JSON.stringify({
        username: 'alice',
        role: 'user',
        signature: 'deadbeef',
        expiresAt,
        sessionType: 'account',
      }),
    );

    const response = (await proxy(createRequest(cookie))) as MockResponse;

    const names = response.cookieCalls.map((call) => call.name);
    expect(names).toEqual(expect.arrayContaining(['auth', 'auth_meta']));
    response.cookieCalls.forEach((call) => {
      expect(call.value).toBe('');
      expect(call.options.expires?.getTime()).toBe(0);
    });
  });

  it('accepts legacy session without re-signing when AUTH_SECRET is missing', async () => {
    delete process.env.AUTH_SECRET;
    const cookie = await buildAuthCookie('owner-pass', Date.now() + HOUR_MS);
    const consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const response = (await proxy(createRequest(cookie))) as MockResponse;

    expect(response.cookieCalls).toHaveLength(0);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '检测到使用旧站长口令验签的会话，建议尽快让用户重新登录，并用 LEGACY_COOKIE_CUTOFF_DATE 关闭兼容期',
    );
  });
});
