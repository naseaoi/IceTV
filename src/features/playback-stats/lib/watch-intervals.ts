import { PLAYBACK_BUCKET_MS } from '@/features/playback-stats/types';
import type { PlaybackAnnualData, PlaybackAnnualSession } from '@/lib/types';

// v2 使用真实桶；v1 从起播时刻连续摊开。年度报告和周期作息共用归属口径。
export function visitWatchIntervals(
  data: PlaybackAnnualData,
  start: number,
  end: number,
  visit: (
    session: PlaybackAnnualSession,
    bucketStart: number,
    ms: number,
    first: number,
    last: number,
  ) => void,
): Set<string> {
  const sessions = new Map(
    data.sessions.filter((s) => s.watch_seconds > 0).map((s) => [s.id, s]),
  );
  const contributing = new Set<string>();
  for (const bucket of data.buckets) {
    const session = sessions.get(bucket.session_id);
    if (
      !session ||
      session.measurement_version !== 2 ||
      bucket.watch_ms <= 0 ||
      bucket.bucket_start < start ||
      bucket.bucket_start >= end
    )
      continue;
    const first = Math.max(bucket.bucket_start, session.started_at);
    const last = Math.max(
      first,
      Math.min(bucket.bucket_start + PLAYBACK_BUCKET_MS, session.ended_at, end),
    );
    visit(session, bucket.bucket_start, bucket.watch_ms, first, last);
    contributing.add(session.id);
  }
  for (const session of sessions.values()) {
    if (session.measurement_version !== 1) continue;
    const first = Math.max(session.started_at, start);
    const last = Math.min(
      session.started_at + session.watch_seconds * 1000,
      end,
    );
    for (let cursor = first; cursor < last; ) {
      const bucketStart =
        Math.floor(cursor / PLAYBACK_BUCKET_MS) * PLAYBACK_BUCKET_MS;
      const next = Math.min(bucketStart + PLAYBACK_BUCKET_MS, last);
      visit(session, Math.max(bucketStart, start), next - cursor, cursor, next);
      contributing.add(session.id);
      cursor = next;
    }
  }
  return contributing;
}
