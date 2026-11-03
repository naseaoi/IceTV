import { NextRequest, NextResponse } from 'next/server';

import {
  isGuardFailure,
  requireActiveUser,
  requireAdmin,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { normalizeUsername } from '@/lib/username';
import {
  decodeReviewCursor,
  reviewIdentity,
  reviewInput,
  ReviewValidationError,
} from '@/lib/video-reviews';

async function jsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ReviewValidationError('请求体必须为有效 JSON');
  }
}

function queryIdentity(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return reviewIdentity(params.get('title'), params.get('year'));
}

function failure(error: unknown) {
  if (error instanceof ReviewValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error('评价操作失败', error);
  return NextResponse.json(
    { error: '评价操作失败，请稍后重试' },
    { status: 500 },
  );
}

function json(value: unknown) {
  return NextResponse.json(value, { headers: { 'Cache-Control': 'no-store' } });
}

export async function handleOwnReview(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request, {
      unauthorizedMessage: '请先登录',
      includeUserStateCode: false,
    });
    if (isGuardFailure(guard)) return guard.response;
    if (request.method === 'PUT') {
      const input = reviewInput(await jsonBody(request));
      const existing = await db.getVideoReview(
        guard.username,
        input.title_norm,
        input.year,
      );
      const now = Date.now();
      // 编辑当前按年份规则匹配的评价，避免未知年份回落后产生两份公开评价。
      const review = {
        ...input,
        year: existing?.year ?? input.year,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };
      await db.setVideoReview(guard.username, review);
      return json({
        review: await db.getVideoReview(
          guard.username,
          review.title_norm,
          review.year,
        ),
      });
    }
    const { title_norm, year } = queryIdentity(request);
    const review = await db.getVideoReview(guard.username, title_norm, year);
    if (request.method === 'DELETE') {
      if (review)
        await db.deleteVideoReview(
          guard.username,
          review.title_norm,
          review.year,
        );
      return json({ ok: true });
    }
    return json({ review });
  } catch (error) {
    return failure(error);
  }
}

export async function handleMyReviews(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request, {
      unauthorizedMessage: '请先登录',
      includeUserStateCode: false,
    });
    if (isGuardFailure(guard)) return guard.response;
    return json({ reviews: await db.getAllVideoReviews(guard.username) });
  } catch (error) {
    return failure(error);
  }
}

export async function handleWorkReviews(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request, {
      unauthorizedMessage: '请先登录',
      includeUserStateCode: false,
    });
    if (isGuardFailure(guard)) return guard.response;
    const { title_norm, year } = queryIdentity(request);
    return json(await db.getPublicVideoReviewsForWork(title_norm, year));
  } catch (error) {
    return failure(error);
  }
}

export async function handleAdminReviews(request: NextRequest) {
  try {
    const guard = await requireAdmin(request, {
      unauthorizedMessage: '请先登录',
      includeUserStateCode: false,
    });
    if (isGuardFailure(guard)) return guard.response;
    if (request.method === 'DELETE') {
      const body = await jsonBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new ReviewValidationError('删除参数无效');
      const { username, title_norm, year } = body as Record<string, unknown>;
      if (
        typeof username !== 'string' ||
        !username.trim() ||
        username.length > 191 ||
        typeof title_norm !== 'string' ||
        !title_norm ||
        title_norm.length > 191 ||
        typeof year !== 'string' ||
        year.length > 16
      )
        throw new ReviewValidationError('删除参数无效');
      // 管理端仅能删除公开记录；用写入谓词隔离并发改为私密的评价。
      await db.deleteVideoReview(
        normalizeUsername(username),
        title_norm,
        year,
        true,
      );
      return json({ ok: true });
    }
    const cursor = request.nextUrl.searchParams.get('cursor') || undefined;
    const q = (request.nextUrl.searchParams.get('q') || '').trim();
    if (q.length > 200)
      throw new ReviewValidationError('搜索关键词最多 200 字');
    decodeReviewCursor(cursor);
    return json(await db.getPublicVideoReviewPage(cursor, q));
  } catch (error) {
    return failure(error);
  }
}
