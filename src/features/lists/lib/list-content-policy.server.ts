import 'server-only';

import type { ListItem, ListSummary } from '@/features/lists/types';
import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import { isAdultSourceBlocked } from '@/lib/yellow';

export async function getBlockedListSources(): Promise<Set<string>> {
  const config = await getConfigForRead();
  return new Set(
    config.SourceConfig.filter((source) =>
      isAdultSourceBlocked(source, config.SiteConfig.DisableYellowFilter),
    ).map((source) => source.key),
  );
}

export function visibleListItems(
  items: ListItem[],
  blocked: Set<string>,
): ListItem[] {
  return items.filter((item) => !blocked.has(item.source));
}

export function visibleListSummary<T extends ListSummary>(
  list: T,
  items: ListItem[],
): T {
  return {
    ...list,
    itemCount: items.length,
    covers: items.slice(0, 4).map((item) => item.cover),
    ...(list.containsItemId &&
    !items.some((item) => item.id === list.containsItemId)
      ? { contains: false, containsItemId: null }
      : {}),
  };
}

export async function filterListSummaries<T extends ListSummary>(
  lists: T[],
  viewer: string | null,
): Promise<T[]> {
  const blocked = await getBlockedListSources();
  if (blocked.size === 0) return lists;
  // 摘要封面没有来源信息；仅存在被过滤源时读取有界片单快照。
  const result: T[] = [];
  for (const list of lists) {
    const detail = await db.getList(list.id, viewer);
    result.push(
      visibleListSummary(list, visibleListItems(detail.items, blocked)),
    );
  }
  return result;
}
