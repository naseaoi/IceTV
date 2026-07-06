import type { PlaybackSession } from '@/lib/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_SECONDS = 60 * 60;

type DevPlaybackSessionInput = {
  id: string;
  source: string;
  videoId: string;
  episodeIndex: number;
  title: string;
  startedAt: number;
  watchSeconds: number;
  lastPosition: number;
  totalTime: number;
  sourceName?: string;
  year?: string;
};

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function buildStartedAt(now: number, daysAgo: number, hour: number): number {
  return startOfLocalDay(now) - daysAgo * DAY_MS + hour * HOUR_SECONDS * 1000;
}

function createDevPlaybackSession(
  input: DevPlaybackSessionInput,
): PlaybackSession {
  const endedAt = input.startedAt + input.watchSeconds * 1000;

  return {
    id: input.id,
    source: input.source,
    video_id: input.videoId,
    episode_index: input.episodeIndex,
    title: input.title,
    source_name: input.sourceName || '开发测试源',
    cover: '/icons/icon-192x192.png',
    year: input.year || '2026',
    started_at: input.startedAt,
    ended_at: endedAt,
    watch_seconds: input.watchSeconds,
    last_position: input.lastPosition,
    total_time: input.totalTime,
    created_at: input.startedAt,
    updated_at: endedAt,
  };
}

export function buildDevPlaybackStatsSessions(
  now = Date.now(),
): PlaybackSession[] {
  return [
    createDevPlaybackSession({
      id: 'dev_seed_playback_001',
      source: 'dev-seed',
      videoId: 'long-title-layout',
      episodeIndex: 1,
      title:
        '特别长的常看内容标题用于测试容器截断和布局稳定性以及不同屏幕宽度下的显示效果',
      startedAt: buildStartedAt(now, 0, 21),
      watchSeconds: 42 * 60,
      lastPosition: 42 * 60,
      totalTime: 48 * 60,
    }),
    createDevPlaybackSession({
      id: 'dev_seed_playback_002',
      source: 'dev-seed',
      videoId: 'long-title-layout',
      episodeIndex: 2,
      title:
        '特别长的常看内容标题用于测试容器截断和布局稳定性以及不同屏幕宽度下的显示效果',
      startedAt: buildStartedAt(now, 1, 20),
      watchSeconds: 38 * 60,
      lastPosition: 38 * 60,
      totalTime: 48 * 60,
    }),
    createDevPlaybackSession({
      id: 'dev_seed_playback_003',
      source: 'dev-seed',
      videoId: 'daily-graph-a',
      episodeIndex: 8,
      title: '最近一周柱状图测试内容 A',
      startedAt: buildStartedAt(now, 2, 22),
      watchSeconds: 65 * 60,
      lastPosition: 65 * 60,
      totalTime: 72 * 60,
    }),
    createDevPlaybackSession({
      id: 'dev_seed_playback_004',
      source: 'dev-seed',
      videoId: 'daily-graph-b',
      episodeIndex: 4,
      title: '最近一周柱状图测试内容 B',
      startedAt: buildStartedAt(now, 3, 19),
      watchSeconds: 24 * 60,
      lastPosition: 24 * 60,
      totalTime: 46 * 60,
    }),
    createDevPlaybackSession({
      id: 'dev_seed_playback_005',
      source: 'dev-seed',
      videoId: 'classic-rewatch',
      episodeIndex: 12,
      title: '高频重看内容',
      startedAt: buildStartedAt(now, 4, 21),
      watchSeconds: 58 * 60,
      lastPosition: 58 * 60,
      totalTime: 61 * 60,
    }),
    createDevPlaybackSession({
      id: 'dev_seed_playback_006',
      source: 'dev-seed',
      videoId: 'classic-rewatch',
      episodeIndex: 13,
      title: '高频重看内容',
      startedAt: buildStartedAt(now, 5, 20),
      watchSeconds: 31 * 60,
      lastPosition: 31 * 60,
      totalTime: 61 * 60,
    }),
    createDevPlaybackSession({
      id: 'dev_seed_playback_007',
      source: 'dev-seed',
      videoId: 'weekend-movie',
      episodeIndex: 1,
      title: '周末电影测试',
      startedAt: buildStartedAt(now, 6, 18),
      watchSeconds: 95 * 60,
      lastPosition: 95 * 60,
      totalTime: 118 * 60,
    }),
    createDevPlaybackSession({
      id: 'dev_seed_playback_008',
      source: 'dev-seed-alt',
      videoId: 'same-title-other-source',
      episodeIndex: 3,
      title: '同名不同源测试',
      startedAt: buildStartedAt(now, 0, 16),
      watchSeconds: 16 * 60,
      lastPosition: 16 * 60,
      totalTime: 44 * 60,
      sourceName: '开发备用源',
    }),
  ];
}
