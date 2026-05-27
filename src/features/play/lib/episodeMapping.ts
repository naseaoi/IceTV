import { SearchResult } from '@/lib/types';

export interface ResolvedEpisodeTarget {
  index: number;
  preserveProgress: boolean;
}

function normalizeEpisodeTitle(title: string): string {
  return title.normalize('NFKC').trim().toLowerCase();
}

export function extractEpisodeNumberFromTitle(title: string): number | null {
  const normalizedTitle = normalizeEpisodeTitle(title);
  if (!normalizedTitle) {
    return null;
  }

  const isSpecialEpisode =
    /^(?:sp|ova|oad|special|pv|cm)\s*[-_.]?\s*\d*/i.test(normalizedTitle) ||
    /特别篇|总集篇|预告|先行/.test(normalizedTitle);

  if (isSpecialEpisode) {
    return null;
  }

  const explicitMatch = normalizedTitle.match(
    /(?:第\s*|ep(?:isode)?\s*)?(\d+(?:\.\d+)?)(?:\s*[集话篇章]|$)/i,
  );
  if (explicitMatch) {
    const episodeNumber = Number.parseFloat(explicitMatch[1]);
    return Number.isFinite(episodeNumber) ? episodeNumber : null;
  }

  const genericMatch = normalizedTitle.match(/(\d+(?:\.\d+)?)/);
  if (!genericMatch) {
    return null;
  }

  const episodeNumber = Number.parseFloat(genericMatch[1]);
  return Number.isFinite(episodeNumber) ? episodeNumber : null;
}

export function resolveEpisodeTargetIndex(
  currentDetail: SearchResult | null,
  currentIndex: number,
  targetDetail: SearchResult | null,
): ResolvedEpisodeTarget {
  const targetEpisodes = targetDetail?.episodes || [];
  if (targetEpisodes.length === 0) {
    return { index: 0, preserveProgress: false };
  }

  const safeCurrentIndex = Number.isInteger(currentIndex)
    ? Math.max(0, currentIndex)
    : 0;
  const fallbackIndex =
    safeCurrentIndex < targetEpisodes.length ? safeCurrentIndex : 0;

  const currentTitles = currentDetail?.episodes_titles || [];
  const targetTitles = targetDetail?.episodes_titles || [];
  const currentHasTitles = currentTitles.length > 0;
  const targetHasTitles = targetTitles.length > 0;

  const currentEpisodeLabel =
    currentTitles[safeCurrentIndex] || `${safeCurrentIndex + 1}`;
  const currentEpisodeNumber =
    extractEpisodeNumberFromTitle(currentEpisodeLabel);

  if (currentEpisodeNumber !== null) {
    const matchedIndex = targetTitles.findIndex((title, index) => {
      const candidate = title || `${index + 1}`;
      return extractEpisodeNumberFromTitle(candidate) === currentEpisodeNumber;
    });

    if (matchedIndex >= 0) {
      return { index: matchedIndex, preserveProgress: true };
    }

    // 目标源提供了标题但没出现该集号，多半是缺集/删减/拆季，禁止按下标硬塞。
    if (targetHasTitles) {
      return { index: fallbackIndex, preserveProgress: false };
    }
  }

  // 两边都没有可信的集标题时，只在总集数相等的前提下按下标兜底，
  // 任一边集数不同就视为无法对齐当前集。
  const currentEpisodesLength = currentDetail?.episodes?.length ?? 0;
  const canTrustIndexFallback =
    !currentHasTitles &&
    !targetHasTitles &&
    currentEpisodesLength === targetEpisodes.length &&
    safeCurrentIndex < targetEpisodes.length;

  return {
    index: fallbackIndex,
    preserveProgress: canTrustIndexFallback,
  };
}
