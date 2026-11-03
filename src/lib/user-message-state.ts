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
  if (update.followReview || update.followReviewReadAt !== undefined)
    next.followReviewReadIds = ids.slice(-200);
  return next;
}
