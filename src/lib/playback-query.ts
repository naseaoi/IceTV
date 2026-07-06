const MAX_PLAYBACK_SEARCH_KEYWORD_LENGTH = 80;

export function normalizePlaybackSearchKeyword(
  keyword: string | undefined,
): string | undefined {
  const normalized = keyword?.trim().replace(/\s+/g, ' ');
  return normalized
    ? normalized.slice(0, MAX_PLAYBACK_SEARCH_KEYWORD_LENGTH)
    : undefined;
}

export function buildPlaybackSearchLikePattern(keyword: string): string {
  return `%${keyword.replace(/[!%_]/g, (char) => `!${char}`)}%`;
}
