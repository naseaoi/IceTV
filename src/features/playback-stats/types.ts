import type {
  PlaybackSession,
  PlaybackWatchBucket,
  WatchHistoryEntry,
  WatchHistoryWrite,
} from '@/lib/types';
import type { WatchLevelUp } from '@/lib/watch-level-types';

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
  levelUp: WatchLevelUp;
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
  episodeCount: number;
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
  hours: number[];
  currentStreak: number;
  buckets: PlaybackPeriodBucket[];
  topWorks: PlaybackTopWork[];
};

// 年度报告中的作品：按作品身份（归一化标题 + 年份）合并多个源，source / videoId / cover 取最近一次观看
export type AnnualReportWork = {
  title: string;
  year: string;
  cover: string;
  source: string;
  videoId: string;
  watchSeconds: number;
  // 年内看过的不同集数
  episodeCount: number;
  firstWatchedAt: number;
  lastWatchedAt: number;
};

export type AnnualReportWorkMoment = {
  title: string;
  year: string;
  cover: string;
  source: string;
  videoId: string;
  at: number;
};

export type AnnualReportCompletion = {
  title: string;
  year: string;
  cover: string;
  completedAt: number;
  firstWatchedAt: number;
  days: number;
};

export type AnnualActivityData = {
  completions: { titleNorm: string; year: string; celebratedAt: number }[];
  completionWatches: {
    title: string;
    year: string;
    cover: string;
    firstAt: number;
    lastAt: number;
  }[];
  lists: {
    id: string;
    name: string;
    visibility: number;
    createdAt: number;
    updatedAt: number;
    itemCount: number;
  }[];
  listItems: {
    listId: string;
    cover: string;
    position: number;
    addedAt: number;
  }[];
  likes: { listId: string; createdAt: number }[];
  capsules: {
    title: string;
    year: string;
    cover: string;
    createdAt: number;
    deliverAt: number;
    ratingThen: number | null;
  }[];
  follows: { createdAt: number }[];
};

// GET /api/playback-stats/annual?year=YYYY&tz=IANA
// 所有日期、月份、小时、星期均按请求时区计算；时长单位为秒
export type AnnualReport = {
  year: number;
  timeZone: string;
  generatedAt: number;
  // 当年在请求时区尚未结束，数据截至 generatedAt
  inProgress: boolean;
  // 有观看统计的年份，降序，至少包含当前请求年
  availableYears: number[];
  // 开启了统计数据保留期限且该年有部分时间早于保留起点，统计可能不完整
  possiblyIncomplete: boolean;
  totals: {
    watchSeconds: number;
    // 其中来自旧版客户端估算的部分（无时间桶，按起播时刻连续摊开）
    estimatedWatchSeconds: number;
    activeDays: number;
    workCount: number;
    episodeCount: number;
    sourceCount: number;
  };
  // 12 项，下标 0 为 1 月
  months: number[];
  // 24 项，下标为本地小时
  hours: number[];
  // 7 项，下标 0 为周一
  weekdays: number[];
  // 本地 0:00–5:00 的观看时长
  lateNightWatchSeconds: number;
  // 按“一天从 5:00 开始”比较本地时刻，取会话结束时刻最晚的一次
  latestNight: (AnnualReportWorkMoment & { localTime: string }) | null;
  peakDay: {
    date: string;
    watchSeconds: number;
    // 当天观看时长最多的作品，最多 3 部
    works: AnnualReportWork[];
  } | null;
  longestStreak: { days: number; startDate: string; endDate: string } | null;
  // 最多 10 部，按时长降序
  topWorks: AnnualReportWork[];
  // 最多 5 个，按时长降序；sourceName 取最近一次会话记录的名称
  topSources: {
    source: string;
    sourceName: string;
    watchSeconds: number;
    workCount: number;
  }[];
  firstWork: AnnualReportWorkMoment | null;
  lastWork: AnnualReportWorkMoment | null;
  completions: {
    count: number;
    longest: AnnualReportCompletion | null;
    fastest: AnnualReportCompletion | null;
  };
  lists: {
    createdCount: number;
    itemCount: number;
    featured: {
      id: string;
      name: string;
      likes: number;
      itemCount: number;
      covers: string[];
    } | null;
  };
  capsules: {
    written: number;
    delivered: number;
    nextDeliverAt: number | null;
    biggestChange: {
      title: string;
      year: string;
      cover: string;
      ratingThen: number;
      ratingNow: number;
    } | null;
  } | null;
  social: {
    newFollowing: number;
    topWorkWatchers: number;
  } | null;
  // 按评价 created_at 归属年份
  reviews: {
    count: number;
    ratedCount: number;
    // 一位小数；无评分为 null
    averageRating: number | null;
    topRated: {
      title: string;
      year: string;
      cover: string;
      rating: number;
    } | null;
  };
};

export type AnnualRecapShareState = {
  year: number;
  published: boolean;
  hideRhythm: boolean;
  publishedAt: number | null;
  updatedAt: number | null;
};
export type PublicAnnualReport = Omit<AnnualReport, 'availableYears'> & {
  rhythmHidden: boolean;
};
export type PublicAnnualRecapResponse = {
  owner: import('@/lib/types').PublicUserRef;
  isSelf: boolean;
  report: PublicAnnualReport;
  years: number[];
};
