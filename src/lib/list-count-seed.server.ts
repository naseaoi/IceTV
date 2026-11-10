import 'server-only';

import type { NextResponse } from 'next/server';

import { CONTINUE_WATCHING_PAGE_SIZE } from '@/features/continue-watching/lib/layout';
import {
  dedupePlaybackSessionsByTitle,
  filterPlaybackHistorySessions,
} from '@/features/playback-stats/lib/history';
import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import type { ListCountCookieName } from '@/lib/list-count-cookies';
import { normalizePlayRecordLimit } from '@/lib/play-records';
import { runtimeParamsFromConfig } from '@/lib/runtime-params';

const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
// 登录路径只扫一批会话，重复观看极多时首页去重条数可能偏少，客户端拿到列表后会纠正
const HISTORY_SEED_SCAN_LIMIT = 200;

async function countHistoryFirstPage(
  username: string,
  pageSize: number,
): Promise<number> {
  const sessions = await db.getPlaybackSessions(username, {
    limit: HISTORY_SEED_SCAN_LIMIT,
  });
  const deduped = dedupePlaybackSessionsByTitle(
    filterPlaybackHistorySessions(sessions),
    { mergeWatchSeconds: true },
  );
  return Math.min(deduped.length, pageSize);
}

// 登录时按与各列表接口相同的口径写入计数，新设备首次进入也能按真实条数渲染骨架；
// 口径与客户端写入处保持一致：有效收藏库总数 libraryTotal、本人评价总数、历史首页去重条数、继续观看上限截断后的条数
async function computeListCounts(
  username: string,
): Promise<Record<ListCountCookieName, number>> {
  const params = runtimeParamsFromConfig(await getConfigForRead());
  const historyPageSize = params.PlaybackHistoryPageSize;
  const [favorites, reviews, history, playRecords] = await Promise.all([
    db.getFavoriteLibraryPage(username, {
      query: '',
      filter: 'all',
      sort: 'saved',
      limit: 1,
    }),
    db.getMyVideoReviewCount(username),
    countHistoryFirstPage(username, historyPageSize),
    db.getPlayRecordPage(username, 1),
  ]);
  return {
    fav_count: favorites.libraryTotal,
    review_count: reviews,
    history_count: history,
    cw_count: Math.min(
      playRecords.total,
      normalizePlayRecordLimit(params.ContinueWatchingLimit),
    ),
    cw_page_count: Math.min(playRecords.total, CONTINUE_WATCHING_PAGE_SIZE),
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
      response.cookies.set(name, String(Math.max(0, Math.floor(value))), {
        path: '/',
        maxAge: MAX_AGE_SECONDS,
        sameSite: 'lax',
      });
    }
  } catch (error) {
    console.warn('写入列表计数失败', error);
  }
}
