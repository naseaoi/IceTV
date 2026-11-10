import type { IStorage, PlaybackSession } from '@/lib/types';

export async function assertWatchHistoryContract(
  storage: IStorage,
): Promise<void> {
  const username = 'history-contract';
  const other = 'history-other';
  const session: PlaybackSession = {
    id: 'history-session-001',
    source: 'Source',
    video_id: 'Video',
    title: 'Hidden 100%_Show',
    source_name: 'Source',
    cover: '',
    year: '2026',
    episode_index: 1,
    started_at: 900000,
    ended_at: 960000,
    watch_seconds: 999,
    last_position: 60,
    total_time: 120,
    created_at: 900000,
    updated_at: 960000,
  };
  const bucket = { start: 900000, watch_ms: 30000 };
  const history = {
    total_episodes: 12,
    group_label: '正片',
    group_index: 1,
    group_total: 12,
  };
  try {
    expect(
      await storage.saveWatchSessionReport(username, session, [], history),
    ).toBeNull();
    expect(
      await storage.getPlaybackPeriodSessions(username, 0, 2000000),
    ).toEqual([]);
    const id = await storage.saveWatchSessionReport(
      username,
      session,
      [bucket],
      history,
    );
    expect(id).toMatch(/^[a-zA-Z0-9_-]{8,80}$/);
    expect(
      await storage.saveWatchSessionReport(
        username,
        session,
        [bucket, { ...bucket, watch_ms: 20000 }],
        { ...history, id: id! },
      ),
    ).toBe(id);
    expect(
      (await storage.getPlaybackPeriodSessions(username, 0, 2000000))[0]
        .watch_seconds,
    ).toBe(30);
    await storage.setPlaybackSession(other, {
      ...session,
      watch_seconds: 1000,
    });
    expect(
      await storage.saveWatchSessionReport(other, session, [bucket], history),
    ).toBeNull();
    expect(await storage.getPlaybackPeriodSessions(other, 0, 2000000)).toEqual(
      [],
    );
    expect(await storage.getWatchHistoryPage(other, { limit: 10 })).toEqual([]);
    await storage.setPlaybackSession(username, {
      ...session,
      watch_seconds: 1000,
    });
    expect(
      (await storage.getPlaybackPeriodSessions(username, 0, 2000000))[0]
        .watch_seconds,
    ).toBe(30);
    const second = {
      ...session,
      id: 'history-session-002',
      episode_index: 2,
      last_position: 80,
      updated_at: 970000,
    };
    expect(
      await storage.saveWatchSessionReport(username, second, [bucket], history),
    ).toBe(id);
    expect(await storage.getWatchHistoryPage(username, { limit: 10 })).toEqual([
      expect.objectContaining({
        id,
        episode_index: 2,
        position: 80,
        first_watched_at: 900000,
        last_watched_at: 970000,
        ...history,
      }),
    ]);
    const third = {
      ...session,
      id: 'history-session-003',
      source: 'source',
      updated_at: 970000,
    };
    const id2 = await storage.saveWatchSessionReport(
      username,
      third,
      [bucket],
      history,
    );
    expect(id2).not.toBe(id);
    const firstPage = await storage.getWatchHistoryPage(username, {
      limit: 1,
      keyword: '100%_',
    });
    expect(firstPage).toHaveLength(1);
    const next = await storage.getWatchHistoryPage(username, {
      limit: 1,
      keyword: '100%_',
      cursor: {
        lastWatchedAt: firstPage[0].last_watched_at,
        id: firstPage[0].id,
      },
    });
    expect(next).toHaveLength(1);
    expect(next[0].id).not.toBe(firstPage[0].id);
    expect(
      await storage.getWatchHistoryPage(username, {
        limit: 10,
        keyword: 'missing',
      }),
    ).toEqual([]);
    await storage.deleteWatchHistoryEntry(other, id!);
    expect(
      await storage.getWatchHistoryPage(username, { limit: 10 }),
    ).toHaveLength(2);
    await storage.deleteWatchHistoryEntry(username, id!);
    expect(
      await storage.saveWatchSessionReport(
        username,
        second,
        [{ ...bucket, watch_ms: 40000 }],
        { ...history, id: id! },
      ),
    ).toBeNull();
    expect(
      await storage.getWatchHistoryPage(username, { limit: 10 }),
    ).toHaveLength(1);
    expect(
      (await storage.getPlaybackPeriodSessions(username, 0, 2000000)).reduce(
        (n, row) => n + row.watch_seconds,
        0,
      ),
    ).toBe(100);
    expect(
      await storage.saveWatchSessionReport(username, third, [bucket], {
        ...history,
        id: 'missing-history',
      }),
    ).toBeNull();
    expect(
      await storage.deletePlaybackSessionsBefore(980000),
    ).toBeGreaterThanOrEqual(3);
    expect(
      await storage.getWatchHistoryPage(username, { limit: 10 }),
    ).toHaveLength(1);
    expect(
      await storage.getPlaybackPeriodSessions(username, 0, 2000000),
    ).toEqual([]);
    // 同会话再次写入不会继承已随保留期清理的桶。
    await storage.saveWatchSessionReport(username, third, [
      { ...bucket, watch_ms: 1000 },
    ]);
    expect(
      (await storage.getPlaybackPeriodSessions(username, 0, 2000000))[0]
        .watch_seconds,
    ).toBe(1);
    // v1 同 id 冲突同样隔离所有者。
    await storage.setPlaybackSession(username, {
      ...session,
      id: 'history-v1-collision',
      watch_seconds: 15,
    });
    await storage.setPlaybackSession(other, {
      ...session,
      id: 'history-v1-collision',
      watch_seconds: 999,
    });
    expect(await storage.getPlaybackPeriodSessions(other, 0, 2000000)).toEqual(
      [],
    );
  } finally {
    await storage.deleteUser(username);
    await storage.deleteUser(other);
  }
  expect(await storage.getWatchHistoryPage(username, { limit: 10 })).toEqual(
    [],
  );
  expect(await storage.getPlaybackPeriodSessions(username, 0, 2000000)).toEqual(
    [],
  );
}
