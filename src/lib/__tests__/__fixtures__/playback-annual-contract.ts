import type { IStorage, PlaybackSession } from '@/lib/types';

export async function assertPlaybackAnnualData(
  storage: IStorage,
): Promise<void> {
  const user = 'annual-user';
  const other = 'annual-other';
  const start = 900000;
  const end = 1800000;
  const session: PlaybackSession = {
    id: 'annual-v1-overlap',
    source: 'a',
    video_id: 'one',
    episode_index: 1,
    title: 'Annual',
    source_name: 'Source',
    cover: '',
    year: '2026',
    started_at: start - 1000,
    ended_at: start + 1000,
    watch_seconds: 2,
    last_position: 0,
    total_time: 100,
    created_at: start,
    updated_at: end,
  };
  try {
    await storage.setPlaybackSession(user, session);
    expect(await storage.hasPlaybackAnnualActivity(user, start, end)).toBe(
      false,
    );
    expect(
      await storage.hasPlaybackAnnualActivity(user, start - 1000, start),
    ).toBe(true);
    expect(
      await storage.hasPlaybackAnnualActivity(other, start - 1000, start),
    ).toBe(false);
    await storage.setPlaybackSession(user, {
      ...session,
      id: 'annual-message-zero',
      started_at: start,
      watch_seconds: 0,
    });
    expect(await storage.hasPlaybackAnnualActivity(user, start, end)).toBe(
      false,
    );
    await storage.updateUserMessageState(user, { annualReportReadYear: 2026 });
    await storage.updateUserMessageState(user, { annualReportReadYear: 2025 });
    await storage.updateUserMessageState(user, { announcementReadAt: 1000 });
    expect(await storage.getUserMessageState(user)).toMatchObject({
      annualReportReadYear: 2026,
      announcementReadAt: 1000,
    });
    await storage.setPlaybackSession(user, {
      ...session,
      id: 'annual-v1-before',
      started_at: start - 2000,
    });
    await storage.setPlaybackSession(user, {
      ...session,
      id: 'annual-v1-end',
      started_at: end,
    });
    await storage.setPlaybackSession(user, {
      ...session,
      id: 'annual-v1-zero',
      started_at: 1,
      watch_seconds: 0,
    });
    await storage.setPlaybackSession(user, {
      ...session,
      id: 'annual-v1-negative',
      started_at: 2,
      watch_seconds: -1,
    });
    const modern = {
      ...session,
      id: 'annual-v2-overlap',
      started_at: 0,
      ended_at: end + 1000,
    };
    const { historyId: historyId } = await storage.saveWatchSessionReport(
      user,
      modern,
      [
        { start: 0, watch_ms: 1000 },
        { start, watch_ms: 2000 },
        { start: end, watch_ms: 3000 },
      ],
      { total_episodes: 1 },
    );
    await storage.saveWatchSessionReport(
      user,
      { ...modern, id: 'annual-v2-outside', started_at: start },
      [{ start: end, watch_ms: 1000 }],
    );
    await storage.saveWatchSessionReport(
      other,
      { ...modern, id: 'annual-other-v2' },
      [{ start, watch_ms: 1000 }],
    );
    await storage.setPlaybackSession(other, {
      ...session,
      id: 'annual-other-v1',
    });
    expect(
      await storage.hasPlaybackAnnualActivity(' ANNUAL-USER ', start, end),
    ).toBe(true);
    expect(
      await storage.hasPlaybackAnnualActivity('annual-missing', start, end),
    ).toBe(false);
    const result = await storage.getPlaybackAnnualData(
      ' ANNUAL-USER ',
      start,
      end,
    );
    expect(result.sessions.map((s) => s.id).sort()).toEqual([
      'annual-v1-overlap',
      'annual-v2-overlap',
    ]);
    expect(result.sessions.find((s) => s.id === modern.id)).toMatchObject({
      measurement_version: 2,
      episode_index: 1,
      source_name: 'Source',
      watch_seconds: 6,
    });
    expect(
      result.sessions.find((s) => s.id === session.id)?.measurement_version,
    ).toBe(1);
    expect(result.buckets).toEqual([
      { session_id: modern.id, bucket_start: start, watch_ms: 2000 },
    ]);
    expect(result.earliestStartedAt).toBe(0);
    await storage.deleteWatchHistoryEntry(user, historyId!);
    expect(await storage.getPlaybackAnnualData(user, start, end)).toEqual(
      result,
    );
    expect(
      await storage.getPlaybackAnnualData('annual-missing', start, end),
    ).toEqual({ sessions: [], buckets: [], earliestStartedAt: null });
    expect(await storage.getPlaybackAnnualData(user, end, start)).toEqual({
      sessions: [],
      buckets: [],
      earliestStartedAt: 0,
    });
  } finally {
    await storage.deleteUser(user);
    await storage.deleteUser(other);
  }
  expect(await storage.getPlaybackAnnualData(user, start, end)).toEqual({
    sessions: [],
    buckets: [],
    earliestStartedAt: null,
  });
}
