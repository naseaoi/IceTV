import { getAvailableApiSites } from '@/lib/config';
import { SearchResult } from '@/lib/types';

import { getDetailFromApi, searchFromApi } from './downstream';

interface FetchVideoDetailOptions {
  source: string;
  id: string;
  fallbackTitle?: string;
}

export async function fetchVideoDetail({
  source,
  id,
  fallbackTitle = '',
}: FetchVideoDetailOptions): Promise<SearchResult> {
  const apiSites = await getAvailableApiSites();
  const apiSite = apiSites.find((site) => site.key === source);
  if (!apiSite) {
    throw new Error('无效的API来源');
  }

  let detailError: unknown;
  try {
    const detail = await getDetailFromApi(apiSite, id);
    if (detail) {
      return detail;
    }
  } catch (error) {
    detailError = error;
  }

  if (fallbackTitle) {
    try {
      const searchData = await searchFromApi(apiSite, fallbackTitle.trim());
      const exactMatch = searchData.find(
        (item: SearchResult) =>
          item.source.toString() === source.toString() &&
          item.id.toString() === id.toString(),
      );
      if (exactMatch) {
        return exactMatch;
      }
    } catch {
      // do nothing
    }
  }

  if (detailError instanceof Error) {
    throw detailError;
  }

  throw new Error('获取视频详情失败');
}
