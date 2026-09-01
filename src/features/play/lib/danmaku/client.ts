import type {
  DanmakuFetchResult,
  DanmakuItem,
  DanmakuMatchCandidate,
} from '@/features/play/lib/danmaku/types';

// 标题形如「【bilibili1】 第22话 魔道争锋1」，来源标签和尾缀都带数字
const EPISODE_ORDINAL_PATTERN = /第\s*(\d{1,4})\s*[集话期]/;
const SOURCE_TAG_PATTERN = /【[^】]*】/g;
const FALLBACK_NUMBER_PATTERN = /(\d{1,4})/;

export async function searchDanmakuCandidates(
  keyword: string,
  signal?: AbortSignal,
): Promise<DanmakuMatchCandidate[]> {
  const response = await fetch(
    `/api/danmaku/search?keyword=${encodeURIComponent(keyword)}`,
    { signal },
  );
  if (!response.ok) return [];

  const payload = (await response.json()) as {
    candidates?: DanmakuMatchCandidate[];
  };
  return Array.isArray(payload.candidates) ? payload.candidates : [];
}

export async function fetchDanmakuComments(
  episodeId: number,
  signal?: AbortSignal,
): Promise<DanmakuItem[]> {
  const response = await fetch(`/api/danmaku/comments?episodeId=${episodeId}`, {
    signal,
  });
  if (!response.ok) return [];

  const payload = (await response.json()) as Partial<DanmakuFetchResult>;
  return Array.isArray(payload.items) ? payload.items : [];
}

export function extractEpisodeNumber(title: string): number | null {
  const ordinal = title.match(EPISODE_ORDINAL_PATTERN);
  if (ordinal) {
    const parsed = Number.parseInt(ordinal[1], 10);
    if (Number.isFinite(parsed)) return parsed;
  }

  const withoutTags = title.replace(SOURCE_TAG_PATTERN, ' ');
  const fallback = withoutTags.match(FALLBACK_NUMBER_PATTERN);
  if (!fallback) return null;

  const parsed = Number.parseInt(fallback[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

// 自动匹配只做首次猜测，命中不准由手动选集兜底
export function pickCandidateByEpisode(
  candidates: DanmakuMatchCandidate[],
  episodeIndex: number,
): DanmakuMatchCandidate | null {
  if (candidates.length === 0) return null;

  const targetEpisode = episodeIndex + 1;
  const byNumber = candidates.find(
    (candidate) =>
      extractEpisodeNumber(candidate.episodeTitle) === targetEpisode,
  );
  if (byNumber) return byNumber;

  return candidates[episodeIndex] ?? null;
}
