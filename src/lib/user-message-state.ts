import { parseFollowReviewMessageId } from '@/lib/follow-review-identity';
import type { UserMessageState, UserMessageStateUpdate } from '@/lib/types';

export function mergeUserMessageState(
  current: UserMessageState,
  update: UserMessageStateUpdate,
): UserMessageState {
  const next = { ...current };
  // 公告版本不具备时间顺序，按调用方读到的旧标识做 CAS，避免迟到请求覆盖新版本。
  if (
    update.announcement &&
    current.readAnnouncementId === update.announcement.previousId
  ) {
    next.readAnnouncementId = update.announcement.id;
  }
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
  return next;
}
