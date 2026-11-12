import type { ListItem } from '@/features/lists/types';
import { isCatalogFavoriteSource } from '@/lib/catalog-favorites';

export function listUrl(id: string) {
  return `/lists/${encodeURIComponent(id)}`;
}

// 条目是添加时的作品快照：有真实源时直达该源，目录作品或无源条目按标题搜索起播
export function listItemPlayUrl(item: ListItem) {
  const year: Record<string, string> =
    item.year && item.year !== 'unknown' ? { year: item.year } : {};
  if (!item.source || !item.sourceId || isCatalogFavoriteSource(item.source)) {
    return `/play?${new URLSearchParams({ title: item.title, ...year })}`;
  }
  return `/play?${new URLSearchParams({
    source: item.source,
    id: item.sourceId,
    title: item.title,
    ...year,
    ...(item.searchTitle ? { stitle: item.searchTitle } : {}),
  })}`;
}
