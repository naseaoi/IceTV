import { NextRequest, NextResponse } from 'next/server';

import {
  bindCatalogFavorite,
  bindDueCatalogFavorites,
} from '@/features/favorites/lib/catalog-binding.server';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { parseStorageKey } from '@/lib/utils';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = await requireActiveUser(request);
  if (isGuardFailure(user)) return user.response;
  try {
    const body = await request.json();
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      ('key' in body &&
        (typeof body.key !== 'string' ||
          body.key.length > 255 ||
          !parseStorageKey(body.key)))
    ) {
      return NextResponse.json(
        { error: '收藏请求格式无效' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const result =
      'key' in body
        ? await bindCatalogFavorite(user, body.key, request.signal)
        : { results: await bindDueCatalogFavorites(user, request.signal) };
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: '收藏请求格式无效' }, { status: 400 });
    console.error('目录收藏绑定请求失败', error);
    return NextResponse.json(
      { error: '收藏绑定暂不可用' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
