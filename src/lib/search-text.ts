import { Converter } from 'opencc-js/t2cn';

let toSimplified: ReturnType<typeof Converter> | undefined;

export function simplifySearchText(text: string): string {
  toSimplified ??= Converter({ from: 'tw', to: 'cn' });
  return toSimplified(text);
}

export function normalizeSearchMatchText(text: string): string {
  return simplifySearchText(text.normalize('NFKC'))
    .toLowerCase()
    .replace(/[《》「」『』【】()[\]（）]/g, '')
    .replace(/[\s\u00a0\u3000·•・.。:：,，!！?？'"`~～_\-—]/g, '');
}

export function isTitleMatchedSearchQuery(
  title: string,
  query: string,
): boolean {
  return normalizeSearchMatchText(title).includes(
    normalizeSearchMatchText(query),
  );
}
