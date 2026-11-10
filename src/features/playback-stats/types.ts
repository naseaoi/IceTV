import type {
  PlaybackSession,
  PlaybackWatchBucket,
  WatchHistoryEntry,
  WatchHistoryWrite,
} from '@/lib/types';

export const PLAYBACK_TOP_WORKS_LIMIT = 10;

export const PLAYBACK_BUCKET_MS = 15 * 60 * 1000;

export type PlaybackHistoryResponse = {
  items: WatchHistoryEntry[];
  // 不透明游标，原样回传
  nextCursor: string | null;
};

// POST /api/playback-stats/session 请求体。
// buckets 为该会话各时间桶的累计值（非增量），服务端取较大值，重试与乱序不会重复累计；
// 会话的 watch_seconds 由服务端按桶汇总，客户端不再上报。
export type PlaybackSessionReport = {
  session: Omit<PlaybackSession, 'watch_seconds' | 'updated_at'>;
  buckets: PlaybackWatchBucket[];
  history?: WatchHistoryWrite;
};

// historyId 为 null：未请求写历史，或携带的历史 id 已被用户删除，客户端本页内不再为该作品写历史
export type PlaybackSessionReportResponse = {
  success: true;
  historyId: string | null;
};

export type PlaybackPeriodType = 'week' | 'month' | 'year';

// week / month 按天（key 为 YYYY-MM-DD），year 按月（key 为 YYYY-MM），均按请求时区切分
export type PlaybackPeriodBucket = {
  key: string;
  start: number;
  end: number;
  watchSeconds: number;
};

// 按作品身份（归一化标题 + 年份）合并多个源，source / videoId / cover 取最近一次观看
export type PlaybackTopWork = {
  title: string;
  year: string;
  cover: string;
  source: string;
  videoId: string;
  watchSeconds: number;
  sessionCount: number;
  lastWatchedAt: number;
};

export type PlaybackPeriodStats = {
  type: PlaybackPeriodType;
  // 周期内任一天，规范化为 YYYY-MM-DD
  date: string;
  timeZone: string;
  start: number;
  end: number;
  watchSeconds: number;
  activeDays: number;
  lifetimeWatchSeconds: number;
  buckets: PlaybackPeriodBucket[];
  topWorks: PlaybackTopWork[];
};
