import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { normalizeUsername } from '@/lib/username';
import { reviewIdentity, ReviewValidationError } from '@/lib/video-reviews';

export async function handleFollowOpinions(request: NextRequest) {
  const json = (value: unknown, status = 200) =>
    NextResponse.json(value, { status, headers: NO_STORE_HEADERS });
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const viewer = normalizeUsername(guard.username);
    const params = request.nextUrl.searchParams;
    const identity = reviewIdentity(params.get('title'), params.get('year'));
    return json(
      await db.getFollowOpinions(viewer, identity.title_norm, identity.year),
    );
  } catch (error) {
    if (error instanceof ReviewValidationError)
      return json({ error: error.message }, 400);
    console.error('获取观影信息失败', error);
    return json({ error: '获取观影信息失败，请稍后重试' }, 500);
  }
}
