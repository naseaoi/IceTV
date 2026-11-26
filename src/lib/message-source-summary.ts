import type { UserMessage } from '@/lib/message-types';
import {
  type SocialExecutor,
  ReviewSocialStorage,
} from '@/lib/review-social-storage';
import { UserNoticeStorage } from '@/lib/user-notice-storage';

export type MessageSummarySource =
  | 'follow-review'
  | 'follow-recap'
  | 'review-reply'
  | 'new-follower'
  | 'review-like'
  | 'user-notice';
export interface MessageSourceSummary {
  items: UserMessage[];
  total: number;
}

// 这些来源的列表都是单条顶层 SELECT，COUNT 窗口在 LIMIT 前执行。
// 复用列表的谓词、排序与映射，摘要限定无游标，空集的总数为零。
export async function readMessageSourceSummary(
  executor: SocialExecutor,
  kind: MessageSummarySource,
  username: string,
  readAt: number,
  readIds: string[],
  now: number,
): Promise<MessageSourceSummary> {
  let total = 0;
  const counted: SocialExecutor = {
    ...executor,
    rows: async <T>(sql: string, params?: unknown[]) => {
      if (!sql.startsWith('SELECT '))
        throw new Error('Message summary requires a SELECT');
      const rows = await executor.rows<T & { message_total: number }>(
        `SELECT COUNT(*) OVER () AS message_total, ${sql.slice(7)}`,
        params,
      );
      total = Number(rows[0]?.message_total ?? 0);
      return rows;
    },
  };
  const social = new ReviewSocialStorage(counted);
  const args = [username, readAt, readIds, now, { limit: 1 }] as const;
  let items: UserMessage[];
  switch (kind) {
    case 'follow-review':
      items = await social.getFollowReviewMessages(...args);
      break;
    case 'follow-recap':
      items = await social.getFollowRecapMessages(...args);
      break;
    case 'review-reply':
      items = await social.getReviewReplyMessages(...args);
      break;
    case 'new-follower':
    case 'review-like':
      items = await social.getSocialNotifications(kind, ...args);
      break;
    case 'user-notice':
      items = await new UserNoticeStorage(counted).messages(...args);
      break;
  }
  return { items, total };
}
