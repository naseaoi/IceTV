import 'server-only';

import type { NextResponse } from 'next/server';

import {
  CONTINUE_WATCHING_LIMIT,
  CONTINUE_WATCHING_PAGE_SIZE,
} from '@/features/continue-watching/lib/layout';
import { countTrackingStrip } from '@/features/continue-watching/lib/tracking-calendar.server';
import { PLAYBACK_HISTORY_PAGE_SIZE } from '@/features/playback-stats/types';
import { db } from '@/lib/db';
import {
  type ListCountCookieName,
  writeListCountCookieOnResponse,
} from '@/lib/list-count-cookies';

async function countHistoryFirstPage(
  username: string,
  pageSize: number,
): Promise<number> {
  return (await db.getWatchHistoryPage(username, { limit: pageSize })).length;
}

// 登录时按与各列表接口相同的口径写入计数，新设备首次进入也能按真实条数渲染骨架；
// 口径与客户端写入处保持一致：有效收藏库总数 libraryTotal、本人评价总数、历史首页条数、片单总数、片单广场可见总数、继续观看上限截断后的条数、追更区条数
async function computeListCounts(
  username: string,
): Promise<Record<ListCountCookieName, number>> {
  const [
    favorites,
    reviews,
    history,
    playRecords,
    lists,
    plaza,
    savedLists,
    tracking,
  ] = await Promise.all([
    db.getFavoriteLibraryPage(username, {
      query: '',
      filter: 'all',
      sort: 'saved',
      limit: 1,
    }),
    db.getMyVideoReviewCount(username),
    countHistoryFirstPage(username, PLAYBACK_HISTORY_PAGE_SIZE),
    db.getPlayRecordPage(username, 1),
    db.countUserLists(username),
    db.countPlazaLists(username),
    db.countSavedLists(username),
    countTrackingStrip(username),
  ]);
  return {
    fav_count: favorites.libraryTotal,
    review_count: reviews,
    history_count: history,
    list_count: lists,
    saved_list_count: savedLists,
    plaza_count: plaza,
    cw_count: Math.min(playRecords.total, CONTINUE_WATCHING_LIMIT),
    cw_page_count: Math.min(playRecords.total, CONTINUE_WATCHING_PAGE_SIZE),
    cw_tracking_count: tracking,
  };
}

// 须在 setAuthCookies 之后调用，覆盖其清除的上一位用户的计数；查询失败时保持清除状态，不影响登录
export async function seedListCountCookies(
  response: NextResponse,
  username: string,
): Promise<void> {
  try {
    const counts = await computeListCounts(username);
    for (const [name, value] of Object.entries(counts)) {
      writeListCountCookieOnResponse(
        response,
        name as ListCountCookieName,
        value,
      );
    }
  } catch (error) {
    console.warn('写入列表计数失败', error);
  }
}
