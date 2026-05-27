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

function titlesLookLikeEpisodeNumbering(titles: string[]): boolean {
  if (titles.length < 2) {
    return false;
  }
  const numbers = new Set<number>();
  let validCount = 0;
  for (let i = 0; i < titles.length; i += 1) {
    const title = titles[i] || '';
    const n = extractEpisodeNumberFromTitle(title);
    if (n !== null) {
      validCount += 1;
      numbers.add(n);
    }
  }
  const threshold = Math.max(2, Math.floor(titles.length / 2));
  return validCount >= threshold && numbers.size >= threshold;
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

  const currentEpisodeLabel =
    currentTitles[safeCurrentIndex] || `${safeCurrentIndex + 1}`;
  const currentEpisodeNumber =
    extractEpisodeNumberFromTitle(currentEpisodeLabel);

  if (currentEpisodeNumber !== null && targetTitles.length > 0) {
    const matchedIndex = targetTitles.findIndex((title, index) => {
      const candidate = title || `${index + 1}`;
      return extractEpisodeNumberFromTitle(candidate) === currentEpisodeNumber;
    });

    if (matchedIndex >= 0) {
      return { index: matchedIndex, preserveProgress: true };
    }

    if (titlesLookLikeEpisodeNumbering(targetTitles)) {
      return { index: fallbackIndex, preserveProgress: false };
    }
  }

  if (safeCurrentIndex < targetEpisodes.length) {
    return { index: safeCurrentIndex, preserveProgress: true };
  }
  return { index: 0, preserveProgress: false };
}
