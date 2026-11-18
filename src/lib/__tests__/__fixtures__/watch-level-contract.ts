import type { IStorage, PlaybackSession } from '@/lib/types';
import { WATCH_LEVEL_BUCKET_CAP_MS } from '@/lib/watch-level';

export const watchLevelSession: PlaybackSession = {
  id: 'level-session-001',
  source: 'source',
  video_id: 'video',
  title: '等级作品',
  source_name: '源',
  cover: '',
  year: '2026',
  episode_index: 3,
  started_at: 900000,
  ended_at: 1800000,
  watch_seconds: 0,
  last_position: 60,
  total_time: 120,
  created_at: 900000,
  updated_at: 1800000,
};

export async function assertWatchLevelContract(storage: IStorage) {
  const user = 'level-user';
  const cap = WATCH_LEVEL_BUCKET_CAP_MS;
  const s = watchLevelSession;
  try {
    expect(await storage.getWatchLevel(user)).toEqual({
      level: 1,
      countedMs: 0,
      events: [],
    });
    const buckets = [{ start: cap, watch_ms: 600000 }];
    expect(await storage.saveWatchSessionReport(user, s, buckets)).toEqual({
      historyId: null,
      levelUp: null,
    });
    await storage.saveWatchSessionReport(user, s, buckets);
    await storage.saveWatchSessionReport(user, s, [
      { start: cap, watch_ms: 100000 },
    ]);
    expect((await storage.getWatchLevel(user)).countedMs).toBe(600000);
    await storage.saveWatchSessionReport(
      user,
      { ...s, id: 'level-session-002' },
      buckets,
    );
    expect((await storage.getWatchLevel(user)).countedMs).toBe(cap);
    const result = await storage.saveWatchSessionReport(
      user,
      { ...s, id: 'level-session-003' },
      Array.from({ length: 7 }, (_, i) => ({
        start: (i + 2) * cap,
        watch_ms: cap,
      })),
    );
    expect(result.levelUp).toEqual({ level: 2 });
    expect((await storage.getWatchLevel(user)).events).toEqual([
      expect.objectContaining({
        level: 2,
        title: s.title,
        reachedAt: s.ended_at,
        episodeIndex: 3,
      }),
    ]);
    const legacy = { ...s, id: 'level-legacy', watch_seconds: 100 };
    await storage.setPlaybackSession(user, legacy);
    await storage.setPlaybackSession(user, { ...legacy, watch_seconds: 50 });
    await storage.setPlaybackSession(user, legacy);
    await storage.setPlaybackSession(user, { ...legacy, watch_seconds: 150 });
    expect((await storage.getWatchLevel(user)).countedMs).toBe(
      7200000 + 150000,
    );
    expect(await storage.setPlaybackSession('level-other', legacy)).toBeNull();
    expect((await storage.getWatchLevel('level-other')).countedMs).toBe(0);
    // 同一 id 固定计量版本，避免旧会话转换后再次计入。
    await storage.saveWatchSessionReport(user, legacy, [
      { start: 0, watch_ms: cap },
    ]);
    await storage.setPlaybackSession(user, { ...s, watch_seconds: 99999 });
    expect((await storage.getWatchLevel(user)).countedMs).toBe(7350000);
    expect(
      await storage.setPlaybackSession(user, {
        ...legacy,
        watch_seconds: 300000,
      }),
    ).toEqual({ level: 4 });
    const state = await storage.getWatchLevel(user);
    expect(state.events.map((e) => e.level)).toEqual([2, 3, 4]);
    expect(state.events.slice(1)).toEqual(
      [3, 4].map((level) =>
        expect.objectContaining({
          level,
          title: legacy.title,
          source: legacy.source,
          videoId: legacy.video_id,
        }),
      ),
    );
    await storage.deletePlaybackSessionsBefore(Number.MAX_SAFE_INTEGER);
    expect(await storage.getWatchLevel(user)).toEqual(state);
  } finally {
    await storage.deleteUser(user);
    await storage.deleteUser('level-other');
  }
  expect(await storage.getWatchLevel(user)).toEqual({
    level: 1,
    countedMs: 0,
    events: [],
  });
}
