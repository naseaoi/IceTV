/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { mergeUserMessageState } from '@/lib/user-message-state';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  isGuardFailure: (value: { response?: unknown }) => !!value.response,
}));
jest.mock('@/lib/db', () => ({
  db: { getUserMessageState: jest.fn(), updateUserMessageState: jest.fn() },
}));
installWebPolyfills();
const { NextResponse } = require('next/server');
const { requireActiveUser } = require('@/lib/api-auth');
const { db } = require('@/lib/db');
const route = require('./route') as typeof import('./route');
const request = (body?: unknown) => ({ json: async () => body }) as NextRequest;
beforeEach(() => {
  jest.clearAllMocks();
  requireActiveUser.mockResolvedValue({ username: 'reader' });
  db.getUserMessageState.mockResolvedValue({});
  db.updateUserMessageState.mockImplementation(
    async (
      _username: string,
      update: Parameters<typeof mergeUserMessageState>[1],
    ) => mergeUserMessageState({}, update),
  );
});
it('设置读写均要求有效登录', async () => {
  requireActiveUser.mockResolvedValue({
    response: NextResponse.json({}, { status: 401 }),
  });
  expect((await route.GET(request())).status).toBe(401);
  expect((await route.PUT(request({ mutedKinds: [] }))).status).toBe(401);
});
it('读取默认设置、严格校验且去重', async () => {
  expect(await (await route.GET(request())).json()).toEqual({ mutedKinds: [] });
  for (const mutedKinds of [
    undefined,
    null,
    'review-like',
    ['announcement'],
    [1],
    ['unknown'],
  ])
    expect((await route.PUT(request({ mutedKinds }))).status).toBe(400);
  const response = await route.PUT(
    request({ mutedKinds: ['review-like', 'new-follower', 'review-like'] }),
  );
  expect(await response.json()).toEqual({
    mutedKinds: ['new-follower', 'review-like'],
  });
  expect(db.updateUserMessageState).toHaveBeenCalledWith('reader', {
    notificationSettings: {
      mutedKinds: ['new-follower', 'review-like'],
      now: expect.any(Number),
    },
  });
});
