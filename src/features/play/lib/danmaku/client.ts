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

export interface DanmakuSourceGroup {
  animeTitle: string;
  providerLabel: string | null;
  displayTitle: string;
  typeDescription?: string;
  candidates: DanmakuMatchCandidate[];
}

// 源标题形如「凡人修仙传(2025)【国产剧】from youku」，尾部提供方单独作标签展示
const PROVIDER_SUFFIX_PATTERN = /\s*from\s+(\S+)\s*$/i;

export function splitSourceProvider(animeTitle: string): {
  providerLabel: string | null;
  displayTitle: string;
} {
  const matched = animeTitle.match(PROVIDER_SUFFIX_PATTERN);
  if (!matched) return { providerLabel: null, displayTitle: animeTitle };

  const displayTitle = animeTitle.replace(PROVIDER_SUFFIX_PATTERN, '').trim();
  if (!displayTitle) return { providerLabel: null, displayTitle: animeTitle };

  return { providerLabel: matched[1], displayTitle };
}

// 候选是多源轮转排列的，按源归并后每组内部恢复原始集顺序
export function groupCandidatesBySource(
  candidates: DanmakuMatchCandidate[],
): DanmakuSourceGroup[] {
  const groups = new Map<string, DanmakuSourceGroup>();
  for (const candidate of candidates) {
    const existing = groups.get(candidate.animeTitle);
    if (existing) {
      existing.candidates.push(candidate);
      continue;
    }
    groups.set(candidate.animeTitle, {
      animeTitle: candidate.animeTitle,
      ...splitSourceProvider(candidate.animeTitle),
      typeDescription: candidate.typeDescription,
      candidates: [candidate],
    });
  }
  return Array.from(groups.values());
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

  // 在首个源内按位置兜底
  const firstSource = candidates[0].animeTitle;
  const sameSource = candidates.filter(
    (candidate) => candidate.animeTitle === firstSource,
  );
  return sameSource[episodeIndex] ?? null;
}
