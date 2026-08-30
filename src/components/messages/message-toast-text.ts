import { UserMessage, UserMessageSummary } from '@/lib/message-types';

export type RefreshMode = 'mount' | 'poll' | 'external' | 'local';

function describeMessage(message: UserMessage): string {
  return message.type === 'announcement'
    ? '有一条新公告'
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
    const single = summary.announcement ?? summary.latestTracking;
    return single ? describeMessage(single) : '有未读消息';
  }

  const addedCount = summary.unreadCount - (previous?.unreadCount ?? 0);
  if (addedCount > 1) return `${addedCount} 条新消息`;

  const announcementChanged =
    !!summary.announcement &&
    summary.announcement.id !== previous?.announcement?.id;
  const changed = announcementChanged
    ? summary.announcement
    : (summary.latestTracking ?? summary.announcement);
  return changed ? describeMessage(changed) : '有新消息';
}
