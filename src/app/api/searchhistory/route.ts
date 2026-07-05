import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getConfigForRead } from '@/lib/config';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { normalizeRuntimeParams } from '@/lib/runtime-params';

export const runtime = 'nodejs';

/**
 * GET /api/searchhistory
 * 返回 string[]
 */
export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const history = await db.getSearchHistory(guardResult.username);
    return NextResponse.json(history, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (err) {
    console.error('获取搜索历史失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/searchhistory
 * body: { keyword: string }
 */
export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const body = await request.json();
    const keyword: string = body.keyword?.trim();

    if (!keyword) {
      return NextResponse.json(
        { error: 'Keyword is required' },
        { status: 400 },
      );
    }

    const runtimeParams = normalizeRuntimeParams(
      (await getConfigForRead()).SiteConfig,
    );

    await db.addSearchHistory(
      guardResult.username,
      keyword,
      runtimeParams.SearchHistoryLimit,
    );

    const history = await db.getSearchHistory(guardResult.username);
    return NextResponse.json(
      history.slice(0, runtimeParams.SearchHistoryLimit),
      { status: 200 },
    );
  } catch (err) {
    console.error('添加搜索历史失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/searchhistory?keyword=<kw>
 *
 * 1. 不带 keyword -> 清空全部搜索历史
 * 2. 带 keyword=<kw> -> 删除单条关键字
 */
export async function DELETE(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const { searchParams } = new URL(request.url);
    const kw = searchParams.get('keyword')?.trim();

    await db.deleteSearchHistory(guardResult.username, kw || undefined);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('删除搜索历史失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
