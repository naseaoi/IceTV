import { UserMessageSummary } from '@/lib/message-types';

export type RefreshMode = 'mount' | 'poll' | 'external' | 'local';

export function buildToastText(summary: UserMessageSummary): string {
  const message = summary.latestUnread;
  if (!message) return '有新消息';
  const nickname = message.nickname ?? '未设置昵称';
  switch (message.type) {
    case 'content-moderated':
    case 'report-result':
    case 'account-change':
      return message.noticeText ?? '有一条新的管理通知';
    case 'follow-recap':
      return `${nickname}公开了 ${message.year} 年度报告`;
    case 'annual-report':
      return `你的 ${message.year} 年度观影报告已生成`;
    case 'announcement':
      return '有一条新公告';
    case 'follow-review':
      return `${nickname}评价了《${message.title}》`;
    case 'review-reply':
      return `${nickname}回复了《${message.title}》`;
    case 'new-follower':
      return `${nickname}关注了你`;
    case 'review-like':
      return `${nickname}赞了你的评价`;
    case 'tracking-update':
      return `《${message.title}》已更新至第 ${message.toEpisodes} 集`;
  }
}
