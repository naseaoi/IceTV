import { UserMessage, UserMessageSummary } from '@/lib/message-types';

export type RefreshMode = 'mount' | 'poll' | 'external' | 'local';

function describeMessage(message: UserMessage): string {
  return message.type === 'announcement'
    ? '有一条新公告'
    : message.type === 'follow-review'
      ? `${message.author.nickname ?? '未设置昵称'}评价了《${message.title}》`
      : message.type === 'review-reply'
        ? `${message.author.nickname ?? '未设置昵称'}回复了《${message.title}》`
        : message.type === 'new-follower'
          ? `${message.follower.nickname ?? '未设置昵称'}关注了你`
          : message.type === 'review-like'
            ? `${message.latestLiker.nickname ?? '未设置昵称'}赞了你的评价`
            : `《${message.title}》已更新至第 ${message.toEpisodes} 集`;
}

// mount 报未读总数，poll 报与上一轮的差值
export function buildToastText(
  summary: UserMessageSummary,
  previous: UserMessageSummary | null,
  mode: RefreshMode,
): string {
  if (mode === 'mount') {
    if (summary.unreadCount > 1) return `${summary.unreadCount} 条未读消息`;
    if (summary.newFollowerUnreadCount > 0) return '有新的关注者';
    if (summary.reviewLikeUnreadCount > 0) return '你的评价收到了新的赞';
    if (summary.reviewReplyUnreadCount > 0) return '收到新的评价回复';
    if (summary.followReviewUnreadCount > 0) return '关注的人发布了新评价';
    const single = summary.announcement ?? summary.latestTracking;
    return single ? describeMessage(single) : '有未读消息';
  }

  const addedCount = summary.unreadCount - (previous?.unreadCount ?? 0);
  if (addedCount > 1) return `${addedCount} 条新消息`;

  if (
    summary.followReviewUnreadCount > (previous?.followReviewUnreadCount ?? 0)
  )
    return '关注的人发布了新评价';

  if (summary.reviewReplyUnreadCount > (previous?.reviewReplyUnreadCount ?? 0))
    return '收到新的评价回复';

  if (summary.newFollowerUnreadCount > (previous?.newFollowerUnreadCount ?? 0))
    return '有新的关注者';
  if (summary.reviewLikeUnreadCount > (previous?.reviewLikeUnreadCount ?? 0))
    return '你的评价收到了新的赞';

  const announcementChanged =
    !!summary.announcement &&
    summary.announcement.id !== previous?.announcement?.id;
  const changed = announcementChanged
    ? summary.announcement
    : (summary.latestTracking ?? summary.announcement);
  return changed ? describeMessage(changed) : '有新消息';
}
