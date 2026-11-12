import {
  buildDevPlaybackBuckets,
  buildDevPlaybackStatsSessions,
} from '@/features/playback-stats/lib/dev-seed';
import { PLAYBACK_BUCKET_MS } from '@/features/playback-stats/types';

describe('dev playback stats seed', () => {
  it('生成 UTC 对齐桶并保留全部观看时长', () => {
    for (const session of buildDevPlaybackStatsSessions()) {
      const buckets = buildDevPlaybackBuckets(session);
      expect(buckets.reduce((sum, bucket) => sum + bucket.watch_ms, 0)).toBe(
        session.watch_seconds * 1000,
      );
      expect(
        buckets.every(
          (bucket) =>
            bucket.start % PLAYBACK_BUCKET_MS === 0 &&
            bucket.watch_ms > 0 &&
            bucket.watch_ms <= PLAYBACK_BUCKET_MS,
        ),
      ).toBe(true);
    }
  });
  it('builds stable playback sessions across recent days', () => {
    const now = new Date('2026-07-06T12:00:00+08:00').getTime();
    const sessions = buildDevPlaybackStatsSessions(now);
    const ids = new Set(sessions.map((session) => session.id));
    const days = new Set(
      sessions.map((session) => {
        const date = new Date(session.started_at);
        date.setHours(0, 0, 0, 0);
        return date.getTime();
      }),
    );

    expect(sessions).toHaveLength(8);
    expect(ids.size).toBe(sessions.length);
    expect(days.size).toBe(7);
    expect(sessions.some((session) => session.title.length > 30)).toBeTruthy();
    expect(sessions.every((session) => session.watch_seconds > 0)).toBeTruthy();
  });
});
