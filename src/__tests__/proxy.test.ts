/** @jest-environment node */

import { webcrypto } from 'crypto';

import type { NextRequest, NextResponse } from 'next/server';

import {
  generateSignature,
  getSignatureData,
  verifySignature,
} from '@/lib/auth.server';
import { proxy } from '@/proxy';

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
  ICETV_AUTH_SECRET: process.env.ICETV_AUTH_SECRET,
  ICETV_PASSWORD: process.env.ICETV_PASSWORD,
  AUTH_SESSION_TTL_HOURS: process.env.AUTH_SESSION_TTL_HOURS,
};

describe('proxy middleware session handling', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'auth-secret';
    process.env.ICETV_PASSWORD = 'owner-pass';
    delete process.env.ICETV_AUTH_SECRET;
    delete process.env.AUTH_SESSION_TTL_HOURS;
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
      'auth-secret',
      Date.now() + 29 * 24 * HOUR_MS,
    );

    const response = (await proxy(createRequest(cookie))) as MockResponse;

    expect(response.cookieCalls).toHaveLength(0);
  });

  it('refreshes near-expiry session with AUTH_SECRET signature', async () => {
    const cookie = await buildAuthCookie('auth-secret', Date.now() + HOUR_MS);

    const response = (await proxy(createRequest(cookie))) as MockResponse;

    const authCall = response.cookieCalls.find((call) => call.name === 'auth');
    expect(authCall).toBeDefined();
    const refreshed = parseAuthCookie(authCall!.value);
    expect(refreshed.expiresAt).toBeGreaterThan(Date.now() + HOUR_MS);
    await expect(
      verifySignature(
        getSignatureData('account', refreshed.expiresAt, 'alice'),
        refreshed.signature,
        'auth-secret',
      ),
    ).resolves.toBe(true);
  });

  it('migrates legacy owner-password session to AUTH_SECRET on refresh', async () => {
    const cookie = await buildAuthCookie('owner-pass', Date.now() + HOUR_MS);

    const response = (await proxy(createRequest(cookie))) as MockResponse;

    const authCall = response.cookieCalls.find((call) => call.name === 'auth');
    expect(authCall).toBeDefined();
    const refreshed = parseAuthCookie(authCall!.value);
    await expect(
      verifySignature(
        getSignatureData('account', refreshed.expiresAt, 'alice'),
        refreshed.signature,
        'auth-secret',
      ),
    ).resolves.toBe(true);
    await expect(
      verifySignature(
        getSignatureData('account', refreshed.expiresAt, 'alice'),
        refreshed.signature,
        'owner-pass',
      ),
    ).resolves.toBe(false);
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

    const response = (await proxy(createRequest(cookie))) as MockResponse;

    expect(response.cookieCalls).toHaveLength(0);
  });
});
