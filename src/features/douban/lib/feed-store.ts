import type { DoubanItem } from '@/lib/types';

import {
  type FeedQuery,
  getDefaultFeedQuery,
  getFeedQueryKey,
  isCalendarQuery,
  uniqueItems,
} from './feed-query';

const FEED_MEMORY_MS = 60 * 60 * 1000;
const FEED_MEMORY_LIMIT = 20;

export interface FeedEntry {
  items: DoubanItem[];
  pageCount: number;
  hasMore: boolean;
  // 首页推荐预填，与分类续页不是同一份榜单快照
  preview: boolean;
  calendarStale: boolean;
  // 第一页的获取时间；续页不延长，返回分类时不会把旧榜单无限期留着
  loadedAt: number;
}

const entries = new Map<string, FeedEntry>();
const lastQueryByType = new Map<string, FeedQuery>();

export function readFeedEntry(query: FeedQuery): FeedEntry | null {
  const key = getFeedQueryKey(query);
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.loadedAt + FEED_MEMORY_MS <= Date.now()) {
    entries.delete(key);
    return null;
  }
  return entry;
}

export function writeFeedEntry(query: FeedQuery, entry: FeedEntry) {
  const key = getFeedQueryKey(query);
  entries.delete(key);
  entries.set(key, entry);
  if (entries.size > FEED_MEMORY_LIMIT) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey) entries.delete(oldestKey);
  }
}

export function readLastFeedQuery(type: string): FeedQuery | null {
  const query = lastQueryByType.get(type);
  if (!query) return null;
  if (!readFeedEntry(query)) {
    lastQueryByType.delete(type);
    return null;
  }
  return query;
}

export function rememberFeedQuery(query: FeedQuery) {
  lastQueryByType.set(query.type, query);
}

// 首页推荐作为分类默认视图的预览；分类自己加载过的数据更新、可能已翻页，不覆盖，也不改用户最近的筛选
export function seedDefaultFeedPreview(
  type: string,
  items: DoubanItem[],
  weekday?: string,
) {
  if (items.length === 0) return;

  const query = getDefaultFeedQuery(type, [], weekday);
  const existing = readFeedEntry(query);
  if (existing && !existing.preview) return;

  const unique = uniqueItems(items);
  writeFeedEntry(query, {
    items: unique,
    pageCount: 1,
    hasMore: !isCalendarQuery(query),
    preview: true,
    calendarStale: false,
    loadedAt: Date.now(),
  });
  if (!readLastFeedQuery(type)) {
    rememberFeedQuery(query);
  }
}
