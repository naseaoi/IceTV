import type { VideoQualityInfo } from '@/features/play/hooks/usePlayPageState';
import { resolveEpisodeTargetIndex } from '@/features/play/lib/episodeMapping';
import {
  type SourcePlaybackStat,
  compareSourcePlaybackPreference,
} from '@/lib/source-playback-stats';
import type { SearchResult } from '@/lib/types';

// 同一次播放意图内最多自动换源的次数，防止所有源都坏时无限轮换
export const AUTO_SOURCE_SWITCH_MAX_ATTEMPTS = 3;

export function buildAutoSwitchSourceKey(source: string, id: string): string {
  return `${source}-${id}`;
}

export function parseLoadSpeedKBps(loadSpeed?: string): number {
  const match = loadSpeed
    ?.trim()
    .match(/^([\d.]+)\s*(Mbps|Mb\/s|KB\/s|MB\/s)$/);
  if (!match) return 0;

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 0;

  switch (match[2]) {
    case 'Mbps':
    case 'Mb/s':
      return (value * 1024) / 8;
    case 'MB/s':
      return value * 1024;
    default:
      return value;
  }
}

export function selectAutoSwitchCandidates({
  availableSources,
  excludedKeys,
  referenceDetail,
  referenceEpisodeIndex,
}: {
  availableSources: readonly SearchResult[];
  excludedKeys: ReadonlySet<string>;
  referenceDetail: SearchResult | null;
  referenceEpisodeIndex: number;
}): SearchResult[] {
  return availableSources.filter((candidate) => {
    if (
      excludedKeys.has(buildAutoSwitchSourceKey(candidate.source, candidate.id))
    ) {
      return false;
    }
    if (!candidate.episodes?.length) {
      return false;
    }
    return resolveEpisodeTargetIndex(
      referenceDetail,
      referenceEpisodeIndex,
      candidate,
    ).preserveProgress;
  });
}

// 本次测速失败是当下的直接证据，先于历史表现排到最后，免得占用有限的自动换源次数；其余按历史播放表现分档，同档内按已测加载速度从快到慢，仍相同时保持原顺序
export function rankAutoSwitchCandidates(
  candidates: readonly SearchResult[],
  videoInfoByKey: ReadonlyMap<string, VideoQualityInfo>,
  playbackStats: ReadonlyMap<string, SourcePlaybackStat>,
  now = Date.now(),
): SearchResult[] {
  return candidates
    .map((candidate, index) => {
      const info = videoInfoByKey.get(
        buildAutoSwitchSourceKey(candidate.source, candidate.id),
      );
      const failed = info?.hasError === true;
      return {
        candidate,
        index,
        playbackStat: playbackStats.get(candidate.source),
        failed,
        speedKBps: info && !failed ? parseLoadSpeedKBps(info.loadSpeed) : 0,
      };
    })
    .sort(
      (a, b) =>
        Number(a.failed) - Number(b.failed) ||
        compareSourcePlaybackPreference(a.playbackStat, b.playbackStat, now) ||
        b.speedKBps - a.speedKBps ||
        a.index - b.index,
    )
    .map(({ candidate }) => candidate);
}
