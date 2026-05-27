export type DoubanType = 'movie' | 'tv' | 'show' | 'anime' | 'custom' | string;

export function getDoubanPageTitle(type: DoubanType): string {
  return type === 'movie'
    ? '电影'
    : type === 'tv'
      ? '剧集'
      : type === 'anime'
        ? '动漫'
        : type === 'show'
          ? '综艺'
          : '自定义';
}

export function getDoubanPageDescription(
  type: DoubanType,
  primarySelection: string,
): string {
  if (type === 'anime' && primarySelection === '每日放送') {
    return '来自 Bangumi 番组计划的精选内容';
  }
  return '来自豆瓣的精选内容';
}

export function getDoubanActivePath(type: DoubanType): string {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  const queryString = params.toString();
  return `/douban${queryString ? `?${queryString}` : ''}`;
}
