import type { VideoQualityInfo } from '@/features/play/hooks/usePlayPageState';
import { resolveEpisodeTargetIndex } from '@/features/play/lib/episodeMapping';
import {
  getFreshProbeInfo,
  seedProbeResults,
} from '@/features/play/lib/sourceProbeStore';
import {
  type SourceSelectionContext,
  compareSourceRoutePreference,
  EMPTY_SOURCE_SELECTION_CONTEXT,
} from '@/features/play/lib/sourceRoutePreference';
import {
  type SourcePlaybackStat,
  compareSourcePlaybackPreference,
} from '@/lib/source-playback-stats';
import {
  readSourceWorkFailures,
  sourceWorkFailureKey,
} from '@/lib/source-work-failures';
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

// 近期作品级失败先排后，其次是有效测速失败；其余沿用可靠性、健康、线路、历史偏好和速度。
export function rankAutoSwitchCandidates(
  candidates: readonly SearchResult[],
  videoInfoByKey: ReadonlyMap<string, VideoQualityInfo>,
  playbackStats: ReadonlyMap<string, SourcePlaybackStat>,
  now = Date.now(),
  selectionContext: SourceSelectionContext = EMPTY_SOURCE_SELECTION_CONTEXT,
): SearchResult[] {
  // 面板尚未挂载时也接入预计算结果；之后只消费 store，过期条目不回退到旧参数。
  seedProbeResults(videoInfoByKey, now);
  const workFailures = readSourceWorkFailures(now);
  return candidates
    .map((candidate, index) => {
      const info = getFreshProbeInfo(
        buildAutoSwitchSourceKey(candidate.source, candidate.id),
        now,
      );
      const failed = info?.hasError === true;
      return {
        candidate,
        index,
        workFailed: workFailures.has(
          sourceWorkFailureKey(candidate.source, candidate.id),
        ),
        playbackStat: playbackStats.get(candidate.source),
        failed,
        speedKBps: info && !failed ? parseLoadSpeedKBps(info.loadSpeed) : 0,
      };
    })
    .sort(
      (a, b) =>
        Number(a.workFailed) - Number(b.workFailed) ||
        Number(a.failed) - Number(b.failed) ||
        compareSourceRoutePreference(
          a.candidate,
          b.candidate,
          selectionContext,
          playbackStats,
          now,
          workFailures,
        ) ||
        compareSourcePlaybackPreference(a.playbackStat, b.playbackStat, now) ||
        b.speedKBps - a.speedKBps ||
        a.index - b.index,
    )
    .map(({ candidate }) => candidate);
}
