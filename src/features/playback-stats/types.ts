import type { PlaybackSession } from '@/lib/types';

export type PlaybackHistoryResponse = {
  items: PlaybackSession[];
  nextCursor: number | null;
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
