/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn().mockResolvedValue({ username: 'reader' }),
  isGuardFailure: (value: { response?: unknown }) => Boolean(value.response),
}));
jest.mock('@/lib/messages.server', () => ({
  getUserMessagePage: jest.fn(),
  getUserMessageSummary: jest.fn(),
  readUserMessage: jest.fn(),
  readAllUserMessages: jest.fn(),
}));
installWebPolyfills();
const { GET, PATCH } = require('./route');
const messages = require('@/lib/messages.server');

function request(body?: unknown, query = ''): NextRequest {
  return {
    url: `http://localhost/api/messages${query}`,
    json: async () => body,
  } as NextRequest;
}

it('returns a social-aware summary and merged page without caching', async () => {
  const summary = {
    unreadCount: 2,
    trackingUnreadCount: 1,
    followReviewUnreadCount: 1,
    revision: 'revision',
    announcement: null,
    latestTracking: null,
  };
  messages.getUserMessageSummary.mockResolvedValue(summary);
  const response = await GET(request(undefined, '?view=summary'));
  expect(await response.json()).toEqual(summary);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  messages.getUserMessagePage.mockResolvedValue({
    items: [],
    total: 0,
    nextCursor: null,
  });
  expect(
    await (await GET(request(undefined, '?cursor=cursor&limit=20'))).json(),
  ).toEqual({ items: [], total: 0, nextCursor: null });
  expect(messages.getUserMessagePage).toHaveBeenCalledWith(
    'reader',
    20,
    'cursor',
  );
});

it('returns an actionable 400 for expired follow pagination', async () => {
  const { ReviewValidationError } = require('@/lib/video-reviews');
  messages.getUserMessagePage.mockRejectedValueOnce(
    new ReviewValidationError('消息分页已更新，请重新打开消息列表'),
  );
  const response = await GET(request(undefined, '?cursor=old'));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: '消息分页已更新，请重新打开消息列表',
  });
});

it('accepts followed-review identifiers and routes read-all', async () => {
  const messageId = `follow-review:${'a'.repeat(1200)}`;
  messages.readUserMessage.mockResolvedValue({
    message: { id: messageId, type: 'follow-review' },
  });
  expect((await PATCH(request({ action: 'read', messageId }))).status).toBe(
    200,
  );
  expect(messages.readUserMessage).toHaveBeenCalledWith('reader', messageId);
  messages.readAllUserMessages.mockResolvedValue({ updatedRecords: {} });
  expect(await (await PATCH(request({ action: 'read-all' }))).json()).toEqual({
    updatedRecords: {},
  });
});
