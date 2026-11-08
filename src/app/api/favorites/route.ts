import { NextRequest, NextResponse } from 'next/server';

import { InvalidFavoriteMutation } from '@/features/favorites/lib/library-mutations';
import type { FavoriteLibraryQuery } from '@/features/favorites/lib/library-query';
import { InvalidFavoriteLibraryQuery } from '@/features/favorites/lib/library-storage';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import {
  isCatalogFavoriteSource,
  isFavoriteWatchStatus,
  isWatchedAt,
} from '@/lib/catalog-favorites';
import { db } from '@/lib/db';
import { normalizeFavoriteLimit, parseFavoriteCursor } from '@/lib/favorites';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { Favorite } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

export const runtime = 'nodejs';

/**
 * GET /api/favorites
 *
 * 支持两种调用方式：
 * 1. 不带 query，返回全部收藏列表（Record<string, Favorite>）。
 * 2. 带 key=source+id，返回单条收藏（Favorite | null）。
 */
export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (searchParams.get('format') === 'work') {
      const item = await db.getFavoriteForWork(guardResult.username, {
        key: key ?? '',
        title: searchParams.get('title') ?? '',
        year: searchParams.get('year') ?? '',
      });
      return NextResponse.json(item, { headers: NO_STORE_HEADERS });
    }

    if (searchParams.get('format') === 'library') {
      const page = await db.getFavoriteLibraryPage(guardResult.username, {
        query: searchParams.get('q') ?? '',
        filter: (searchParams.get('filter') ??
          'all') as FavoriteLibraryQuery['filter'],
        sort: (searchParams.get('sort') ??
          'saved') as FavoriteLibraryQuery['sort'],
        cursor: searchParams.get('cursor'),
      });
      return NextResponse.json(page, { headers: NO_STORE_HEADERS });
    }

    if (searchParams.get('format') === 'page') {
      const cursor = parseFavoriteCursor(searchParams.get('cursor'));
      const page = await db.getFavoritePage(
        guardResult.username,
        normalizeFavoriteLimit(searchParams.get('limit')),
        cursor?.time,
        cursor?.key,
      );
      return NextResponse.json(page, {
        status: 200,
        headers: NO_STORE_HEADERS,
      });
    }

    // 查询单条收藏
    if (key) {
      const parsed = parseStorageKey(key);
      if (!parsed) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 },
        );
      }
      const fav = await db.getFavorite(
        guardResult.username,
        parsed.source,
        parsed.id,
      );
      return NextResponse.json(fav, {
        status: 200,
        headers: NO_STORE_HEADERS,
      });
    }

    // 查询全部收藏
    const favorites = await db.getAllFavorites(guardResult.username);
    return NextResponse.json(favorites, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (err) {
    if (
      err instanceof InvalidFavoriteLibraryQuery ||
      err instanceof InvalidFavoriteMutation
    ) {
      return NextResponse.json(
        { error: err.message },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    console.error('获取收藏失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/favorites
 * body: { key: string; favorite: Favorite }
 */
export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json({ error: '收藏请求格式无效' }, { status: 400 });
    const { key, favorite }: { key: string; favorite: Favorite } = body;

    if (
      typeof key !== 'string' ||
      !key ||
      key.length > 255 ||
      !favorite ||
      typeof favorite !== 'object' ||
      Array.isArray(favorite)
    ) {
      return NextResponse.json(
        { error: 'Missing key or favorite' },
        { status: 400 },
      );
    }

    // 验证必要字段
    if (
      typeof favorite.title !== 'string' ||
      !favorite.title.trim() ||
      favorite.title.length > 500 ||
      typeof favorite.source_name !== 'string' ||
      !favorite.source_name ||
      (favorite.year !== undefined && typeof favorite.year !== 'string') ||
      (favorite.search_title !== undefined &&
        typeof favorite.search_title !== 'string') ||
      (favorite.save_time !== undefined && !isWatchedAt(favorite.save_time)) ||
      (favorite.watch_status !== undefined &&
        !isFavoriteWatchStatus(favorite.watch_status)) ||
      (favorite.watched_at !== undefined &&
        (!isWatchedAt(favorite.watched_at) ||
          favorite.watch_status !== 'completed'))
    ) {
      return NextResponse.json(
        { error: 'Invalid favorite data' },
        { status: 400 },
      );
    }

    const parsed = parseStorageKey(key);
    if (!parsed) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 400 },
      );
    }

    if (
      isCatalogFavoriteSource(parsed.source) &&
      !/^[1-9]\d*$/.test(parsed.id)
    ) {
      return NextResponse.json({ error: '目录作品编号无效' }, { status: 400 });
    }
    const now = Date.now();
    const finalFavorite = {
      ...favorite,
      ...(isCatalogFavoriteSource(parsed.source)
        ? {
            source_name: parsed.source === 'douban' ? '豆瓣' : 'Bangumi',
            origin: 'vod' as const,
          }
        : {}),
      save_time: favorite.save_time ?? now,
      metadata_checked_at: now,
    } as Favorite;

    const finalKey = await db.saveFavorite(
      guardResult.username,
      parsed.source,
      parsed.id,
      finalFavorite,
    );

    return NextResponse.json(
      { success: true, key: finalKey ?? key },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof SyntaxError)
      return NextResponse.json({ error: '收藏请求格式无效' }, { status: 400 });
    console.error('保存收藏失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/favorites
 *
 * 1. 不带 query -> 清空全部收藏
 * 2. 带 key=source+id -> 删除单条收藏
 */
export async function DELETE(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const username = guardResult.username;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      // 删除单条
      const parsed = parseStorageKey(key);
      if (!parsed) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 },
        );
      }
      await db.deleteFavorite(username, parsed.source, parsed.id);
    } else {
      await db.deleteAllFavorites(username);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('删除收藏失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
