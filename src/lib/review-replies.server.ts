import 'server-only';

import { NextRequest } from 'next/server';

import {
  isGuardFailure,
  requireActiveUser,
  requireAdmin,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { validateReplyContent } from '@/lib/review-reply-storage';
import { type ReviewReportReason, REVIEW_REPORT_REASONS } from '@/lib/types';
import {
  requireNickname,
  socialBody,
  socialFailure,
  socialJson,
} from '@/lib/user-profile.server';
import { ReviewValidationError } from '@/lib/video-reviews';

export function replyId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value))
    throw new ReviewValidationError('回复标识无效');
  return value;
}

export async function handleReviewReplies(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    if (request.method === 'DELETE') {
      const deleted = await db.deleteReviewReply(
        replyId(request.nextUrl.searchParams.get('id')),
        guard.username,
      );
      return deleted
        ? socialJson({ ok: true })
        : socialJson({ error: '回复不存在或无权删除' }, 404);
    }
    if (request.method === 'POST') {
      const failure = await requireNickname(guard.username);
      if (failure) return failure;
    }
    const body =
      request.method === 'GET'
        ? Object.fromEntries(request.nextUrl.searchParams.entries())
        : await socialBody(request);
    if (
      typeof body.profileId !== 'string' ||
      !/^[A-Za-z0-9]{12}$/.test(body.profileId) ||
      typeof body.title_norm !== 'string' ||
      !body.title_norm.trim() ||
      body.title_norm.length > 191 ||
      typeof body.year !== 'string' ||
      body.year.length > 16
    )
      throw new ReviewValidationError('评价标识无效');
    const profile = await db.getUserProfileById(body.profileId);
    if (!profile) return socialJson({ error: '评价不存在' }, 404);
    if (request.method === 'GET')
      return socialJson(
        await db.getReviewReplies(
          profile.username,
          body.title_norm,
          body.year,
          guard.username,
          request.nextUrl.searchParams.get('cursor') || undefined,
        ),
      );
    const reply = await db.postReviewReply(
      profile.username,
      body.title_norm,
      body.year,
      guard.username,
      validateReplyContent(body.content),
      body.replyToId === undefined ? undefined : replyId(body.replyToId),
    );
    return reply
      ? socialJson(reply)
      : socialJson({ error: '公开评价不存在' }, 404);
  } catch (error) {
    return socialFailure(error);
  }
}

export async function handleReplyReport(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const failure = await requireNickname(guard.username);
    if (failure) return failure;
    const body = await socialBody(request);
    const id = replyId(body.id);
    if (!REVIEW_REPORT_REASONS.includes(body.reason as ReviewReportReason))
      throw new ReviewValidationError('举报原因无效');
    const detail = body.detail ?? '';
    if (typeof detail !== 'string' || detail.trim().length > 200)
      throw new ReviewValidationError('举报说明最多 200 字');
    const saved = await db.reportReviewReply(
      id,
      guard.username,
      body.reason as ReviewReportReason,
      detail.trim(),
    );
    return saved
      ? socialJson({ ok: true })
      : socialJson({ error: '回复不存在或不能举报自己' }, 404);
  } catch (error) {
    return socialFailure(error);
  }
}

export async function handleAdminReplyDelete(request: NextRequest) {
  try {
    const guard = await requireAdmin(request);
    if (isGuardFailure(guard)) return guard.response;
    await db.deleteReviewReply(
      replyId(request.nextUrl.searchParams.get('id')),
      guard.username,
      true,
    );
    return socialJson({ ok: true });
  } catch (error) {
    return socialFailure(error);
  }
}
