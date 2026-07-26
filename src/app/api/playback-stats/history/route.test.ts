/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import type { PlaybackSession } from '@/lib/types';

installWebPolyfills();

const mockGetConfigForRead = jest.fn();
const mockGetPlaybackSessions = jest.fn();

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest
    .fn()
    .mockResolvedValue({ username: 'demo', isOwner: false, role: 'user' }),
  isGuardFailure: (result: object) => 'response' in result,
}));

jest.mock('@/lib/config', () => ({
  getConfigForRead: (...args: unknown[]) => mockGetConfigForRead(...args),
}));

jest.mock('@/lib/db', () => ({
  db: {
    getPlaybackSessions: (...args: unknown[]) =>
      mockGetPlaybackSessions(...args),
    deletePlaybackSession: jest.fn(),
  },
}));

const { GET } = require('./route') as typeof import('./route');

function createRequest(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

function createSession(
  id: string,
  title: string,
  startedAt: number,
): PlaybackSession {
  return {
    id,
    source: 'source-a',
    video_id: id,
    episode_index: 1,
    title,
    source_name: 'Source A',
    cover: '',
    year: '2026',
    started_at: startedAt,
    ended_at: startedAt + 1,
    watch_seconds: 10,
    last_position: 10,
    total_time: 100,
    created_at: startedAt,
    updated_at: startedAt,
  };
}

describe('playback history route', () => {
  const recentSessions = Array.from({ length: 50 }, (_, index) =>
    createSession(`recent_${index}`, '本周重复观看', 1000 - index),
  );
  const olderSessions = [
    createSession('older_title_b', '较早记录 B', 900),
    createSession('older_title_c', '较早记录 C', 800),
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfigForRead.mockResolvedValue({
      SiteConfig: {
        PlaybackHistoryPageSize: 2,
        PlaybackHistoryLimit: 500,
      },
    });
    mockGetPlaybackSessions.mockImplementation(
      async (_username: string, query: { cursor?: number }) => {
        if (query.cursor === undefined) return recentSessions;
        if (query.cursor === 951) return olderSessions;
        return [];
      },
    );
  });

  it('最近会话大量重复时继续扫描并返回完整分页', async () => {
    const firstResponse = await GET(
      createRequest('http://localhost/api/playback-stats/history?limit=2'),
    );
    const firstPage = await firstResponse.json();

    expect(firstPage.items.map((item: PlaybackSession) => item.title)).toEqual([
      '本周重复观看',
      '较早记录 B',
    ]);
    expect(firstPage.nextCursor).toBe(2);
    expect(firstPage.items).toHaveLength(2);
    expect(mockGetPlaybackSessions).toHaveBeenCalledTimes(2);

    mockGetPlaybackSessions.mockClear();
    const secondResponse = await GET(
      createRequest(
        'http://localhost/api/playback-stats/history?limit=2&cursor=2',
      ),
    );
    const secondPage = await secondResponse.json();

    expect(secondPage.items.map((item: PlaybackSession) => item.title)).toEqual(
      ['较早记录 C'],
    );
    expect(secondPage.nextCursor).toBeNull();
    expect(mockGetPlaybackSessions).toHaveBeenCalledTimes(2);
  });
});
