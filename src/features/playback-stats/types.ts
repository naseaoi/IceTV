import type { PlaybackSession, PlaybackStatsTopItem } from '@/lib/types';

export type PlaybackDailyStat = {
  date: string;
  watchSeconds: number;
};

export type PlaybackTopItem = PlaybackStatsTopItem;

export type PlaybackStatsSummary = {
  totalWatchSeconds: number;
  weekWatchSeconds: number;
  dailyWatchSeconds: PlaybackDailyStat[];
  recentItems: PlaybackSession[];
  topItems: PlaybackTopItem[];
};

export type PlaybackHistoryResponse = {
  items: PlaybackSession[];
  nextCursor: number | null;
};
