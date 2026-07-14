import {
  dedupePlaybackSessionsByTitle,
  filterPlaybackHistorySessions,
} from '@/features/playback-stats/lib/history';
import { buildPlaybackStatsSummary } from '@/features/playback-stats/lib/summary';
import type { PlaybackSession } from '@/lib/types';

function createSession(
  partial: Partial<PlaybackSession> & { id: string },
): PlaybackSession {
  return {
    id: partial.id,
    source: partial.source || 'source',
    video_id: partial.video_id || partial.id,
    episode_index: partial.episode_index || 1,
    title: partial.title || 'Demo',
    source_name: partial.source_name || 'Source',
    cover: partial.cover || '',
    year: partial.year || '2026',
    started_at: partial.started_at || 1000,
    ended_at: partial.ended_at || partial.started_at || 1000,
    watch_seconds: partial.watch_seconds || 0,
    last_position: partial.last_position || 0,
    total_time: partial.total_time || 0,
    created_at: partial.created_at || partial.started_at || 1000,
    updated_at: partial.updated_at || partial.ended_at || 1000,
  };
}

describe('playback history dedupe', () => {
  it('keeps the latest session for the same source and title', () => {
    const episode39 = createSession({
      id: 'session_39',
      source: 'source-a',
      title: 'Re: 从零开始的异世界生活',
      episode_index: 39,
      started_at: 1000,
      ended_at: 2000,
      last_position: 120,
    });
    const episode40 = createSession({
      id: 'session_40',
      source: 'source-a',
      title: ' Re:  从零开始的异世界生活 ',
      episode_index: 40,
      started_at: 3000,
      ended_at: 4000,
      last_position: 60,
    });

    expect(dedupePlaybackSessionsByTitle([episode39, episode40])).toEqual([
      episode40,
    ]);
  });

  it('keeps same-title sessions from different sources', () => {
    const sourceA = createSession({
      id: 'session_source_a',
      source: 'source-a',
      source_name: '源站A',
      title: '你的名字',
      started_at: 1000,
      ended_at: 2000,
    });
    const sourceB = createSession({
      id: 'session_source_b',
      source: 'source-b',
      source_name: '源站B',
      title: '你的名字',
      started_at: 3000,
      ended_at: 4000,
    });

    expect(dedupePlaybackSessionsByTitle([sourceA, sourceB])).toEqual([
      sourceB,
      sourceA,
    ]);
  });

  it('can merge watch seconds into the latest session', () => {
    const watchedSession = createSession({
      id: 'session_watched',
      source: 'source-a',
      title: 'Demo',
      episode_index: 1,
      watch_seconds: 75,
      started_at: 1000,
      ended_at: 2000,
    });
    const latestSession = createSession({
      id: 'session_latest',
      source: 'source-a',
      title: ' Demo ',
      episode_index: 2,
      watch_seconds: 0,
      started_at: 3000,
      ended_at: 4000,
    });

    expect(
      dedupePlaybackSessionsByTitle([watchedSession, latestSession], {
        mergeWatchSeconds: true,
      }),
    ).toEqual([{ ...latestSession, watch_seconds: 75 }]);
  });

  it('filters sessions without watched seconds from history', () => {
    const failedSession = createSession({
      id: 'session_failed',
      watch_seconds: 0,
      started_at: 3000,
      ended_at: 4000,
    });
    const watchedSession = createSession({
      id: 'session_watched',
      watch_seconds: 30,
      started_at: 1000,
      ended_at: 2000,
    });

    expect(
      dedupePlaybackSessionsByTitle(
        filterPlaybackHistorySessions([failedSession, watchedSession]),
        {
          mergeWatchSeconds: true,
        },
      ),
    ).toEqual([watchedSession]);
  });

  it('dedupes recent summary items without changing watch totals', () => {
    const sessions = [
      createSession({
        id: 'session_39',
        title: 'Demo',
        episode_index: 39,
        watch_seconds: 30,
        started_at: 1000,
        ended_at: 2000,
      }),
      createSession({
        id: 'session_40',
        title: 'Demo',
        episode_index: 40,
        watch_seconds: 50,
        started_at: 3000,
        ended_at: 4000,
      }),
    ];

    const summary = buildPlaybackStatsSummary(sessions, 5000);

    expect(summary.totalWatchSeconds).toBe(80);
    expect(summary.recentItems).toEqual([sessions[1]]);
  });
});
