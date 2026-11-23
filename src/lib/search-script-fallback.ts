import { simplifySearchText } from '@/lib/search-text';

// 仅繁体或混合输入补查简体：多数源站只有简体，简体转繁体补查基本落空。
// 原词与补查词分别缓存；每个源最多补查一次，异常不触发补查。
export async function searchWithScriptFallback<T>(
  query: string,
  search: (keyword: string, isFallback: boolean) => Promise<T>,
  hasMatches: (result: T) => boolean,
  signal?: AbortSignal,
): Promise<T> {
  const result = await search(query, false);
  if (signal?.aborted || hasMatches(result)) return result;
  const simplified = simplifySearchText(query);
  return simplified === query ? result : search(simplified, true);
}
