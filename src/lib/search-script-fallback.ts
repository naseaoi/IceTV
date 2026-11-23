import { Converter } from 'opencc-js/cn2t';

import { simplifySearchText } from '@/lib/search-text';

const toTraditional = Converter({ from: 'cn', to: 'tw' });

// 原词与补查词分别缓存；每个源最多补查一次，异常不触发补查。
export async function searchWithScriptFallback<T>(
  query: string,
  search: (keyword: string) => Promise<T>,
  hasMatches: (result: T) => boolean,
  signal?: AbortSignal,
): Promise<T> {
  const result = await search(query);
  if (signal?.aborted || hasMatches(result)) return result;
  const simplified = simplifySearchText(query);
  const alternate = simplified === query ? toTraditional(query) : simplified;
  return alternate === query ? result : search(alternate);
}
