export type DisplayConverter = (text: string) => string;

// 条数上限保护高频短文案；总字符预算（键加值约 1 MiB）让简介等长文本也能命中，单条超长文本不缓存。
export const DISPLAY_TEXT_CACHE_SIZE = 2048;
const CACHE_CHAR_BUDGET = 512 * 1024;
const MAX_CACHED_TEXT_LENGTH = 4096;
const CJK = /[㐀-鿿豈-﫿\u{20000}-\u{323af}]/u;

export function createCachedDisplayConverter(
  convert: DisplayConverter,
): DisplayConverter {
  const cache = new Map<string, string>();
  let cachedChars = 0;
  return (text) => {
    if (!CJK.test(text)) return text;
    const cached = cache.get(text);
    if (cached !== undefined) {
      cache.delete(text);
      cache.set(text, cached);
      return cached;
    }
    const result = convert(text);
    const size = text.length + result.length;
    if (size <= MAX_CACHED_TEXT_LENGTH * 2) {
      while (
        cache.size >= DISPLAY_TEXT_CACHE_SIZE ||
        cachedChars + size > CACHE_CHAR_BUDGET
      ) {
        const [oldest, value] = cache.entries().next().value!;
        cache.delete(oldest);
        cachedChars -= oldest.length + value.length;
      }
      cache.set(text, result);
      cachedChars += size;
    }
    return result;
  };
}
