/** @jest-environment node */
import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { PLAYBACK_BUCKET_MS } from '@/features/playback-stats/types';
installWebPolyfills();
const mockV1 = jest.fn();
const mockV2 = jest.fn();
const mockGuard = jest.fn();
jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: (...args: unknown[]) => mockGuard(...args),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/db', () => ({
  db: {
    savePlaybackSession: (...args: unknown[]) => mockV1(...args),
    saveWatchSessionReport: (...args: unknown[]) => mockV2(...args),
  },
}));
const { POST } = require('./route') as typeof import('./route');
const start = Math.floor(Date.now() / PLAYBACK_BUCKET_MS) * PLAYBACK_BUCKET_MS;
const session = {
  id: 'session_1234',
  source: 'source',
  video_id: 'video',
  title: ' title ',
  episode_index: 1,
  started_at: start,
  ended_at: start + 1000,
  created_at: start,
  watch_seconds: 999,
  last_position: 30,
  total_time: 60,
};
const bucket = { start, watch_ms: 1000 };
const request = (body: unknown) => ({ json: async () => body }) as NextRequest;
beforeEach(() => {
  jest.clearAllMocks();
  mockGuard.mockResolvedValue({ username: 'demo' });
  mockV1.mockResolvedValue(null);
  mockV2.mockResolvedValue({
    historyId: 'history_1234',
    levelUp: { level: 2 },
  });
});
it('v2 桶和规范化历史一起写入并返回 id', async () => {
  const response = await POST(
    request({
      session,
      buckets: [bucket],
      history: {
        total_episodes: 12,
        group_label: ' x ',
        group_index: 1,
        group_total: 12,
      },
    }),
  );
  expect(await response.json()).toEqual({
    success: true,
    historyId: 'history_1234',
    levelUp: { level: 2 },
  });
  expect(mockV2).toHaveBeenCalledWith(
    'demo',
    expect.objectContaining({ title: 'title' }),
    [bucket],
    expect.objectContaining({ total_episodes: 12, group_label: 'x' }),
  );
  expect(mockV1).not.toHaveBeenCalled();
});
it.each([
  null,
  {},
  Array.from({ length: 101 }, () => bucket),
  [{ ...bucket, start: start + 1 }],
  [{ ...bucket, start: start - 2 * PLAYBACK_BUCKET_MS }],
  [{ ...bucket, start: start + 2 * PLAYBACK_BUCKET_MS }],
  [{ ...bucket, watch_ms: 0 }],
  [{ ...bucket, watch_ms: -1 }],
  [{ ...bucket, watch_ms: PLAYBACK_BUCKET_MS + 1 }],
  [{ ...bucket, watch_ms: '1000' }],
])('拒绝非法桶 %j', async (buckets) => {
  expect((await POST(request({ session, buckets }))).status).toBe(400);
  expect(mockV2).not.toHaveBeenCalled();
});
it.each([
  { id: 'bad', total_episodes: 1 },
  { total_episodes: 0 },
  { total_episodes: 1, group_index: -1 },
  null,
])('拒绝非法历史 %j', async (history) => {
  expect(
    (await POST(request({ session, buckets: [bucket], history }))).status,
  ).toBe(400);
  expect(mockV2).not.toHaveBeenCalled();
});
it('v1 保持客户端秒数且不写历史，零时长不落库', async () => {
  await POST(request({ session, history: { total_episodes: 1 } }));
  expect(mockV1).toHaveBeenCalledWith(
    'demo',
    expect.objectContaining({ watch_seconds: 999 }),
  );
  expect(mockV2).not.toHaveBeenCalled();
  mockV1.mockClear();
  expect(
    await (
      await POST(request({ session: { ...session, watch_seconds: 0 } }))
    ).json(),
  ).toEqual({ success: true, historyId: null, levelUp: null });
  expect(mockV1).not.toHaveBeenCalled();
});
it('空桶仍交给存储确认已有累计值，已删历史返回 null', async () => {
  mockV2.mockResolvedValue({ historyId: null, levelUp: null });
  expect(
    await (
      await POST(
        request({
          session,
          buckets: [],
          history: { id: 'history_1234', total_episodes: 1 },
        }),
      )
    ).json(),
  ).toEqual({ success: true, historyId: null, levelUp: null });
});
it('非法 JSON 与未登录请求不会写入', async () => {
  const bad = {
    json: async () => {
      throw new SyntaxError('Invalid JSON');
    },
  } as unknown as NextRequest;
  expect((await POST(bad)).status).toBe(400);
  mockGuard.mockResolvedValue({
    response: new Response(null, { status: 401 }),
  });
  expect((await POST(request({ session, buckets: [bucket] }))).status).toBe(
    401,
  );
  expect(mockV1).not.toHaveBeenCalled();
  expect(mockV2).not.toHaveBeenCalled();
});
it('异常信息留在服务端', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockV2.mockRejectedValue(new Error('private SQL'));
  const response = await POST(request({ session, buckets: [bucket] }));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Internal Server Error' });
  spy.mockRestore();
});
