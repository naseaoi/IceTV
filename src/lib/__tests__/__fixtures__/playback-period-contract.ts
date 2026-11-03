import type { IStorage, PlaybackSession } from '@/lib/types';

export async function assertPlaybackPeriodRange(
  storage: IStorage,
): Promise<void> {
  const username = 'period-range-user';
  const otherUser = 'period-range-other';
  const session: PlaybackSession = {
    id: 'period-start',
    source: 'source-a',
    video_id: 'video-a',
    episode_index: 1,
    title: 'Show A',
    source_name: 'Source A',
    cover: 'cover-a',
    year: '2026',
    started_at: 100,
    ended_at: 150,
    watch_seconds: 60,
    last_position: 60,
    total_time: 120,
    created_at: 100,
    updated_at: 150,
  };
  const rows = [
    session,
    { ...session, id: 'period-before', started_at: 99 },
    { ...session, id: 'period-inside', started_at: 199, ended_at: 250 },
    { ...session, id: 'period-end', started_at: 200 },
    { ...session, id: 'period-zero', watch_seconds: 0 },
    { ...session, id: 'period-negative', watch_seconds: -1 },
  ];
  try {
    for (const row of rows) await storage.setPlaybackSession(username, row);
    await storage.setPlaybackSession(otherUser, {
      ...session,
      id: 'period-other',
    });
    const result = await storage.getPlaybackPeriodSessions(
      ' PERIOD-RANGE-USER ',
      100,
      200,
    );
    expect(result).toHaveLength(2);
    expect(result.map((row) => row.started_at).sort((a, b) => a - b)).toEqual([
      100, 199,
    ]);
    expect(result.find((row) => row.started_at === 100)).toEqual({
      source: 'source-a',
      video_id: 'video-a',
      title: 'Show A',
      cover: 'cover-a',
      year: '2026',
      started_at: 100,
      ended_at: 150,
      watch_seconds: 60,
    });
    await expect(
      storage.getPlaybackPeriodSessions(username, 200, 200),
    ).resolves.toEqual([]);
    await expect(
      storage.getPlaybackPeriodSessions(username, 201, 200),
    ).resolves.toEqual([]);
    await expect(
      storage.getPlaybackPeriodSessions(username, NaN, 200),
    ).resolves.toEqual([]);
    await expect(
      storage.getPlaybackPeriodSessions('period-missing', 100, 200),
    ).resolves.toEqual([]);
  } finally {
    for (const row of rows)
      await storage.deletePlaybackSession(username, row.id);
    await storage.deletePlaybackSession(otherUser, 'period-other');
  }
}
