import { parseAnnouncementMessageId } from '@/lib/announcement-identity';
import { parseFollowReviewMessageId } from '@/lib/follow-review-identity';
import { parseReplyMessageId } from '@/lib/review-reply-storage';
import { parseSocialNotificationId } from '@/lib/social-notification-identity';
import type { UserMessageState, UserMessageStateUpdate } from '@/lib/types';

export function mergeUserMessageState(
  current: UserMessageState,
  update: UserMessageStateUpdate,
): UserMessageState {
  if (update.notificationSettings) {
    const settings = update.notificationSettings;
    const reopened = (current.mutedKinds ?? []).filter(
      (kind) => !settings.mutedKinds.includes(kind),
    );
    // 在存储事务读到的最新状态上计算重新开启的水位，避免并发设置覆盖已读状态。
    update = { ...update };
    if (reopened.includes('follow-review'))
      update.followReviewReadAt = Math.max(
        update.followReviewReadAt ?? 0,
        settings.now,
      );
    if (reopened.includes('review-reply'))
      update.reviewReplyReadAt = Math.max(
        update.reviewReplyReadAt ?? 0,
        settings.now,
      );
    if (reopened.includes('new-follower'))
      update.newFollowerReadAt = Math.max(
        update.newFollowerReadAt ?? 0,
        settings.now,
      );
    if (reopened.includes('review-like'))
      update.reviewLikeReadAt = Math.max(
        update.reviewLikeReadAt ?? 0,
        settings.now,
      );
  }
  const next = { ...current };
  if (update.notificationSettings)
    next.mutedKinds = [...update.notificationSettings.mutedKinds];
  const previousWatermark = current.followReviewReadAt ?? 0;
  const watermark = Math.max(previousWatermark, update.followReviewReadAt ?? 0);
  if (update.followReviewReadAt !== undefined)
    next.followReviewReadAt = watermark;
  let ids = [...new Set(current.followReviewReadIds ?? [])];
  if (watermark > previousWatermark) {
    // 新水位之后已单独读过的动态仍需保留；旧格式无法解析的标识随全部已读清除。
    ids = ids.filter((id) => {
      try {
        const value: unknown = JSON.parse(
          Buffer.from(id.slice('follow-review:'.length), 'base64url').toString(
            'utf8',
          ),
        );
        return (
          Array.isArray(value) &&
          typeof value[3] === 'number' &&
          value[3] > watermark
        );
      } catch {
        return false;
      }
    });
  }
  if (
    update.followReview &&
    update.followReview.createdAt > watermark &&
    !ids.includes(update.followReview.id)
  )
    ids.push(update.followReview.id);
  if (ids.length > 200) {
    const times = ids
      .map((id) => parseFollowReviewMessageId(id)?.[3] ?? 0)
      .sort((a, b) => a - b);
    // 有界已读集压缩为时间水位；同毫秒的整批一并确认，旧已读项不会复活。
    next.followReviewReadAt = Math.max(watermark, times[times.length - 201]);
    ids = ids.filter(
      (id) =>
        (parseFollowReviewMessageId(id)?.[3] ?? 0) > next.followReviewReadAt!,
    );
  }
  if (update.followReview || update.followReviewReadAt !== undefined)
    next.followReviewReadIds = ids;
  const previousReplyWatermark = current.reviewReplyReadAt ?? 0;
  let replyWatermark = Math.max(
    previousReplyWatermark,
    update.reviewReplyReadAt ?? 0,
  );
  let replyIds = [...new Set(current.reviewReplyReadIds ?? [])].filter(
    (id) => (parseReplyMessageId(id)?.createdAt ?? 0) > replyWatermark,
  );
  if (
    update.reviewReply &&
    update.reviewReply.createdAt > replyWatermark &&
    !replyIds.includes(update.reviewReply.id)
  )
    replyIds.push(update.reviewReply.id);
  if (replyIds.length > 200) {
    const times = replyIds
      .map((id) => parseReplyMessageId(id)?.createdAt ?? 0)
      .sort((a, b) => a - b);
    replyWatermark = Math.max(replyWatermark, times[times.length - 201]);
    replyIds = replyIds.filter(
      (id) => (parseReplyMessageId(id)?.createdAt ?? 0) > replyWatermark,
    );
  }
  if (update.reviewReply || update.reviewReplyReadAt !== undefined) {
    next.reviewReplyReadAt = replyWatermark;
    next.reviewReplyReadIds = replyIds;
  }
  for (const [field, timestamp] of [
    [
      'newFollower',
      (id: string) => parseSocialNotificationId('new-follower', id)?.[3] ?? 0,
    ],
    [
      'reviewLike',
      (id: string) => parseSocialNotificationId('review-like', id)?.[3] ?? 0,
    ],
    [
      'announcement',
      (id: string) => parseAnnouncementMessageId(id)?.publishedAt ?? 0,
    ],
  ] as const) {
    const timeKey = `${field}ReadAt` as const;
    const idsKey = `${field}ReadIds` as const;
    let mark = Math.max(current[timeKey] ?? 0, update[timeKey] ?? 0);
    let readIds = [...new Set(current[idsKey] ?? [])].filter(
      (id) => timestamp(id) > mark,
    );
    const single = update[field];
    if (single && single.createdAt > mark && !readIds.includes(single.id))
      readIds.push(single.id);
    if (readIds.length > 200) {
      const times = readIds.map(timestamp).sort((a, b) => a - b);
      mark = Math.max(mark, times[times.length - 201]);
      readIds = readIds.filter((id) => timestamp(id) > mark);
    }
    if (single || update[timeKey] !== undefined) {
      next[timeKey] = mark;
      next[idsKey] = readIds;
    }
  }
  return next;
}
