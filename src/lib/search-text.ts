import { Converter } from 'opencc-js/t2cn';

const toSimplified = Converter({ from: 'tw', to: 'cn' });

export function simplifySearchText(text: string): string {
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
