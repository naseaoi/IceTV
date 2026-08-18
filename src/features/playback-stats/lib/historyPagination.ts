import {
  dedupePlaybackSessionsByTitle,
  filterPlaybackHistorySessions,
} from '@/features/playback-stats/lib/history';
import type { PlaybackHistoryResponse } from '@/features/playback-stats/types';
import type { PlaybackSession, PlaybackSessionQuery } from '@/lib/types';

const MIN_HISTORY_SCAN_BATCH_SIZE = 50;
const MAX_HISTORY_SCAN_BATCH_SIZE = 500;

type FetchPlaybackSessions = (
  query: Pick<PlaybackSessionQuery, 'cursor' | 'limit'>,
) => Promise<PlaybackSession[]>;

export async function getPlaybackHistoryPage(
  fetchSessions: FetchPlaybackSessions,
  offset: number,
  limit: number,
  historyLimit: number,
): Promise<PlaybackHistoryResponse> {
  const targetCount = Math.min(historyLimit, offset + limit + 1);
  const batchSize = Math.min(
    Math.max(targetCount * 5, MIN_HISTORY_SCAN_BATCH_SIZE),
    MAX_HISTORY_SCAN_BATCH_SIZE,
  );
  let scanCursor: number | undefined;
  let dedupedSessions = [] as PlaybackHistoryResponse['items'];

  while (dedupedSessions.length < targetCount) {
    const sessions = await fetchSessions({
      limit: batchSize,
      cursor: scanCursor,
    });
    if (sessions.length === 0) break;

    dedupedSessions = dedupePlaybackSessionsByTitle(
      [...dedupedSessions, ...filterPlaybackHistorySessions(sessions)],
      { mergeWatchSeconds: true },
    );

    if (sessions.length < batchSize) break;
    const nextScanCursor = sessions[sessions.length - 1]?.started_at;
    if (
      !Number.isFinite(nextScanCursor) ||
      nextScanCursor <= 0 ||
      (scanCursor !== undefined && nextScanCursor >= scanCursor)
    ) {
      break;
    }
    scanCursor = nextScanCursor;
  }

  const items = dedupedSessions.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    items,
    nextCursor:
      dedupedSessions.length > nextOffset && nextOffset < historyLimit
        ? nextOffset
        : null,
  };
}
