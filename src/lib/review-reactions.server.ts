import 'server-only';

import { NextRequest } from 'next/server';

import {
  isGuardFailure,
  requireActiveUser,
  requireAdmin,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { type ReviewReportReason, REVIEW_REPORT_REASONS } from '@/lib/types';
import {
  requireNickname,
  socialBody,
  socialFailure,
  socialJson,
} from '@/lib/user-profile.server';
import { normalizeUsername } from '@/lib/username';
import { ReviewValidationError } from '@/lib/video-reviews';

function targetIdentity(body: Record<string, unknown>) {
  if (
    typeof body.title_norm !== 'string' ||
    !body.title_norm.trim() ||
    body.title_norm.length > 191 ||
    typeof body.year !== 'string' ||
    body.year.length > 16
  )
    throw new ReviewValidationError('评价标识无效');
  return { title: body.title_norm, year: body.year };
}

export async function handleReviewReaction(
  request: NextRequest,
  kind: 'like' | 'report',
) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const nicknameFailure = await requireNickname(guard.username);
    if (nicknameFailure) return nicknameFailure;
    const body =
      request.method === 'DELETE'
        ? Object.fromEntries(request.nextUrl.searchParams.entries())
        : await socialBody(request);
    const { title, year } = targetIdentity(body);
    if (
      typeof body.profileId !== 'string' ||
      !/^[A-Za-z0-9]{12}$/.test(body.profileId)
    )
      throw new ReviewValidationError('用户标识无效');
    const profile = await db.getUserProfileById(body.profileId);
    if (!profile) return socialJson({ error: '评价不存在' }, 404);
    if (kind === 'like') {
      const result = await db.setVideoReviewLike(
        profile.username,
        title,
        year,
        guard.username,
        request.method === 'PUT',
      );
      return result
        ? socialJson(result)
        : socialJson({ error: '评价不存在' }, 404);
    }
    if (!REVIEW_REPORT_REASONS.includes(body.reason as ReviewReportReason))
      throw new ReviewValidationError('举报原因无效');
    const detail = body.detail ?? '';
    if (typeof detail !== 'string' || detail.trim().length > 200)
      throw new ReviewValidationError('举报说明最多 200 字');
    const result = await db.reportVideoReview(
      profile.username,
      title,
      year,
      guard.username,
      body.reason as ReviewReportReason,
      detail.trim(),
    );
    return result
      ? socialJson({ ok: true })
      : socialJson({ error: '评价不存在' }, 404);
  } catch (error) {
    return socialFailure(error);
  }
}

export async function handleAdminReviewReports(request: NextRequest) {
  try {
    const guard = await requireAdmin(request);
    if (isGuardFailure(guard)) return guard.response;
    if (request.method === 'GET')
      return socialJson(
        await db.getReviewReportPage(
          request.nextUrl.searchParams.get('cursor') || undefined,
        ),
      );
    const body = await socialBody(request);
    const { title, year } = targetIdentity(body);
    if (
      typeof body.username !== 'string' ||
      !body.username.trim() ||
      body.username.length > 191
    )
      throw new ReviewValidationError('用户名无效');
    if (
      body.action !== 'dismiss' &&
      body.action !== 'mark-spoiler' &&
      body.action !== 'delete-review'
    )
      throw new ReviewValidationError('审核动作无效');
    await db.moderateReviewReports(
      normalizeUsername(body.username),
      title,
      year,
      body.action,
    );
    return socialJson({ ok: true });
  } catch (error) {
    return socialFailure(error);
  }
}
