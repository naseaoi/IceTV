import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { normalizeUsername } from '@/lib/username';
import { reviewIdentity, ReviewValidationError } from '@/lib/video-reviews';

export async function handleViewingInsights(
  request: NextRequest,
  action: 'opinions' | 'taste-match',
) {
  const json = (value: unknown, status = 200) =>
    NextResponse.json(value, { status, headers: NO_STORE_HEADERS });
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const viewer = normalizeUsername(guard.username);
    const params = request.nextUrl.searchParams;
    if (action === 'opinions') {
      const identity = reviewIdentity(params.get('title'), params.get('year'));
      return json(
        await db.getFollowOpinions(viewer, identity.title_norm, identity.year),
      );
    }
    const profileId = params.get('profileId');
    if (!profileId || !/^[a-zA-Z0-9]{12}$/.test(profileId))
      return json({ error: '用户标识无效' }, 400);
    const profile = await db.getUserProfileById(profileId);
    if (!profile) return json({ error: '用户不存在' }, 404);
    if (normalizeUsername(profile.username) === viewer)
      return json({ error: '请选择其他用户' }, 400);
    return json(await db.getTasteMatch(viewer, profile.username));
  } catch (error) {
    if (error instanceof ReviewValidationError)
      return json({ error: error.message }, 400);
    console.error('获取观影信息失败', error);
    return json({ error: '获取观影信息失败，请稍后重试' }, 500);
  }
}
