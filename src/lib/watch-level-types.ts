import type { WatchLevel } from '@/lib/watch-level';

export type WatchLevelUp = { level: WatchLevel } | null;

export type WatchLevelEvent = {
  level: WatchLevel;
  reachedAt: number;
  title: string;
  year: string;
  episodeIndex: number;
  source: string;
  videoId: string;
};

export type WatchLevelResponse = {
  level: WatchLevel;
  countedMs: number;
  events: WatchLevelEvent[];
};

export type WatchSessionSaveResult = {
  historyId: string | null;
  levelUp: WatchLevelUp;
};
