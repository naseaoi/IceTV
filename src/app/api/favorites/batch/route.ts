import { NextRequest, NextResponse } from 'next/server';

import {
  InvalidFavoriteMutation,
  validateFavoriteBatch,
} from '@/features/favorites/lib/library-mutations';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const input = validateFavoriteBatch(await request.json());
    return NextResponse.json(await db.batchFavorites(guard.username, input), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    if (
      error instanceof InvalidFavoriteMutation ||
      error instanceof SyntaxError
    ) {
      return NextResponse.json(
        { error: '收藏操作参数无效' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    console.error('批量更新收藏失败', error);
    return NextResponse.json(
      { error: '收藏更新失败，请稍后重试' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
