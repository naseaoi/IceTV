import type {
  MessageToastPreview,
  UserMessageSummary,
} from '@/lib/message-types';

import { buildToastText } from './message-toast-text';

it.each<[MessageToastPreview, string]>([
  [
    { type: 'account-change', createdAt: 5, noticeText: '你已被设为管理员' },
    '你已被设为管理员',
  ],
  [
    { type: 'report-result', createdAt: 5, noticeText: '你的举报已处理' },
    '你的举报已处理',
  ],
  [
    { type: 'content-moderated', createdAt: 5, noticeText: '你的回复已被删除' },
    '你的回复已被删除',
  ],
  [{ type: 'announcement', createdAt: 5 }, '有一条新公告'],
  [
    { type: 'tracking-update', title: '剧集', toEpisodes: 12, createdAt: 5 },
    '《剧集》已更新至第 12 集',
  ],
  [
    { type: 'follow-review', nickname: '小明', title: '电影', createdAt: 5 },
    '小明评价了《电影》',
  ],
  [
    { type: 'review-reply', nickname: '小明', title: '电影', createdAt: 5 },
    '小明回复了《电影》',
  ],
  [{ type: 'new-follower', nickname: '小明', createdAt: 5 }, '小明关注了你'],
  [{ type: 'review-like', nickname: '小明', createdAt: 5 }, '小明赞了你的评价'],
  [
    { type: 'annual-report', year: 2026, createdAt: 5 },
    '你的 2026 年度观影报告已生成',
  ],
  [
    { type: 'follow-recap', nickname: '小明', year: 2026, createdAt: 5 },
    '小明公开了 2026 年度报告',
  ],
])('只描述服务端最新事件 %j', (latestUnread, text) => {
  expect(
    buildToastText({ latestUnread, unreadCount: 20 } as UserMessageSummary),
  ).toBe(text);
});
