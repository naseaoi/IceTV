import { normalizeLiveChannelName } from '@/features/live/lib/liveChannelName';
import type { LiveChannel } from '@/features/live/types';
import {
  type LiveLineResult,
  LIVE_LINE_RESULT_TTL_MS,
} from '@/lib/live-line-results';

export interface LiveChannelGroup extends LiveChannel {
  groupKey: string;
  /** 始终保存订阅顺序，线路编号与排序解耦。 */
  lines: LiveChannel[];
}

export function liveChannelGroupKey(name: string): string {
  return normalizeLiveChannelName(name) || name;
}
export function liveGroupFavoriteId(groupKey: string): string {
  return `live_group_${encodeURIComponent(groupKey)}`;
}
export function liveLineKey(line: LiveChannel): string {
  return line.lineId || line.id;
}

/** 调用方按直播源隔离输入；Map 保留首次出现顺序。 */
export function groupLiveChannels(channels: LiveChannel[]): LiveChannelGroup[] {
  const groups = new Map<string, LiveChannelGroup>();
  for (const channel of channels) {
    const groupKey = liveChannelGroupKey(channel.name);
    const existing = groups.get(groupKey);
    if (existing) existing.lines.push(channel);
    else groups.set(groupKey, { ...channel, groupKey, lines: [channel] });
  }
  return [...groups.values()];
}

export function sortLiveLines(
  lines: LiveChannel[],
  results: ReadonlyMap<string, LiveLineResult> = new Map(),
  now = Date.now(),
): LiveChannel[] {
  const rank = (line: LiveChannel) => {
    const result = results.get(line.lineId);
    const recent =
      result && result.at <= now && now - result.at < LIVE_LINE_RESULT_TTL_MS
        ? result
        : undefined;
    if (recent?.ok) return 0;
    if (line.health?.status === 'ended') return 6;
    if (recent?.ok === false) return 5;
    return { ok: 1, slow: 2, unknown: 3, failed: 5, ended: 6 }[
      line.health?.status || 'unknown'
    ];
  };
  return [...lines].sort((a, b) => {
    const aRank = rank(a),
      bRank = rank(b);
    return (
      aRank - bRank ||
      (aRank === 1
        ? (a.health?.latencyMs ?? Infinity) - (b.health?.latencyMs ?? Infinity)
        : 0)
    );
  });
}

export function matchesLiveChannel(
  group: LiveChannelGroup,
  query: string,
): boolean {
  const value = query.trim().toLowerCase();
  const normalized = normalizeLiveChannelName(value);
  return group.lines.some(
    (line) =>
      line.name.toLowerCase().includes(value) ||
      Boolean(
        normalized && liveChannelGroupKey(line.name).includes(normalized),
      ),
  );
}
