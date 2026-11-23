// 作品身份不做简繁转换，避免改变已存评价、收藏与进度的匹配键。
export const normalizeWorkTitle = (title: string): string => {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u00A0\u3000]+/g, '')
    .replace(/[·•・.。:：,，!！?？'"`~～_\-—]/g, '');
};

export const normalizeWorkYear = (year: string | undefined): string => {
  const trimmed = (year || '').trim();
  return trimmed.toLowerCase() === 'unknown' ? '' : trimmed;
};
