export const MAX_SEARCH_QUERY_LENGTH = 80;
export const MIN_SEARCH_SUGGESTION_LENGTH = 2;

export function normalizeSearchQueryInput(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_SEARCH_QUERY_LENGTH);
}

export function shouldRequestSearchSuggestions(value: string): boolean {
  return (
    Array.from(normalizeSearchQueryInput(value)).length >=
    MIN_SEARCH_SUGGESTION_LENGTH
  );
}
