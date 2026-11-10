import { createHash, randomUUID } from 'crypto';

import type { MessageCursor } from '@/lib/message-cursor.server';
import type { SocialExecutor } from '@/lib/review-social-storage';
import {
  type UserNoticeKind,
  type UserNoticeMessage,
  type UserNoticePayload,
  parseUserNoticeId,
} from '@/lib/user-notice';
import { normalizeUsername } from '@/lib/username';

export const USER_NOTICE_WINDOW_MS = 30 * 86400000;
export function userNoticeSchema(dialect: 'sqlite' | 'mysql'): string[] {
  const mysql = dialect === 'mysql';
  return [
    `CREATE TABLE IF NOT EXISTS user_notice_events (id VARCHAR(36) PRIMARY KEY, recipient_username ${mysql ? 'VARCHAR(191)' : 'TEXT'} NOT NULL, event_key VARCHAR(64) NOT NULL, kind VARCHAR(32) NOT NULL, action VARCHAR(32) NOT NULL, payload_json TEXT NOT NULL, created_at BIGINT NOT NULL, UNIQUE (recipient_username, event_key)${mysql ? ', KEY idx_user_notice_recipient (recipient_username, created_at, id)' : ''})${mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin' : ''}`,
    ...(!mysql
      ? [
          'CREATE INDEX IF NOT EXISTS idx_user_notice_recipient ON user_notice_events(recipient_username, created_at, id)',
        ]
      : []),
  ];
}
export function noticeInsert(
  dialect: 'sqlite' | 'mysql',
  recipient: string,
  key: string,
  kind: UserNoticeKind,
  action: string,
  payload: UserNoticePayload,
  now = Date.now(),
) {
  return {
    sql: `INSERT ${dialect === 'sqlite' ? 'OR IGNORE' : 'IGNORE'} INTO user_notice_events (id, recipient_username, event_key, kind, action, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [
      randomUUID(),
      normalizeUsername(recipient),
      createHash('sha256').update(key).digest('hex'),
      kind,
      action,
      JSON.stringify(payload),
      now,
    ],
  };
}
export interface UserNoticeQuery {
  limit: number;
  before?: MessageCursor | null;
  id?: string;
}
export class UserNoticeStorage {
  constructor(private readonly db: SocialExecutor) {}
  private where(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
    query?: UserNoticeQuery,
  ) {
    const parts = ['recipient_username = ?', 'created_at > ?'];
    const params: unknown[] = [
      normalizeUsername(username),
      Math.max(readAt, now - USER_NOTICE_WINDOW_MS),
    ];
    const ids = readIds.flatMap((id) => {
      const parsed = parseUserNoticeId(id);
      return parsed ? [parsed.rowId] : [];
    });
    if (ids.length) {
      parts.push(`id NOT IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
    if (query?.id) {
      const parsed = parseUserNoticeId(query.id);
      parts.push('id = ?', 'created_at = ?');
      params.push(parsed?.rowId ?? '', parsed?.createdAt ?? 0);
    }
    if (query?.before) {
      const { createdAt, key } = query.before;
      parts.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(
        createdAt,
        createdAt,
        key.startsWith('user-notice:')
          ? key.slice(12)
          : key > 'user-notice:'
            ? '￿'
            : '',
      );
    }
    return { sql: parts.join(' AND '), params };
  }
  async messages(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
    query: UserNoticeQuery,
  ): Promise<UserNoticeMessage[]> {
    const { sql, params } = this.where(username, readAt, readIds, now, query);
    const rows = await this.db.rows<{
      id: string;
      kind: UserNoticeKind;
      action: string;
      payload_json: string;
      created_at: number;
    }>(
      `SELECT id, kind, action, payload_json, created_at FROM user_notice_events WHERE ${sql} ORDER BY created_at DESC, id DESC LIMIT ?`,
      [...params, query.limit],
    );
    return rows.map((row) => ({
      id: `user-notice:${row.created_at}:${row.id}`,
      type: row.kind,
      action: row.action,
      payload: JSON.parse(row.payload_json),
      createdAt: Number(row.created_at),
    }));
  }
  async count(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
  ): Promise<number> {
    const { sql, params } = this.where(username, readAt, readIds, now);
    return Number(
      (
        await this.db.rows<{ total: number }>(
          `SELECT COUNT(*) AS total FROM user_notice_events WHERE ${sql}`,
          params,
        )
      )[0]?.total ?? 0,
    );
  }
}

type Row = Record<string, unknown>;
export interface NoticeStatement {
  sql: string;
  params: unknown[];
  read?: boolean;
}
export type NoticeMutation = Generator<NoticeStatement, number, Row[]>;
// 同一 SQL 流程由 SQLite 同步事务和 MySQL 异步事务执行，通知与删除始终一起提交。
export class NoticeModeration {
  constructor(private readonly dialect: 'sqlite' | 'mysql') {}
  private select(sql: string, params: unknown[]): NoticeStatement {
    return {
      sql: sql + (this.dialect === 'mysql' ? ' FOR UPDATE' : ''),
      params,
      read: true,
    };
  }
  private event(
    recipient: string,
    key: string,
    kind: UserNoticeKind,
    action: string,
    payload: UserNoticePayload,
  ): NoticeStatement {
    return noticeInsert(this.dialect, recipient, key, kind, action, payload);
  }
  *review(
    author: string,
    title: string,
    year: string,
    action: 'dismiss' | 'mark-spoiler' | 'delete-review',
    admin: boolean,
  ): NoticeMutation {
    const target = [normalizeUsername(author), title, year];
    const rows = yield this.select(
      `SELECT review_json FROM video_reviews WHERE username = ? AND title_norm = ? AND year = ?${admin ? ' AND is_public = 1' : ''}`,
      target,
    );
    if (!rows.length) return 0;
    const review = JSON.parse(String(rows[0].review_json));
    const payload: UserNoticePayload = {
      title: String(review.title || title),
      year,
      contentType: 'review',
    };
    const reports = yield this.select(
      'SELECT reporter, created_at FROM video_review_reports WHERE author = ? AND title_norm = ? AND year = ?',
      target,
    );
    if (admin)
      for (const report of reports)
        yield this.event(
          String(report.reporter),
          `review-report:${JSON.stringify(target)}:${report.created_at}`,
          'report-result',
          action,
          payload,
        );
    if (action === 'delete-review') {
      const replies = yield this.select(
        'SELECT id, username, created_at FROM video_review_replies WHERE author = ? AND title_norm = ? AND year = ?',
        target,
      );
      if (admin) {
        const recipients = new Map<string, number>([[target[0], 1]]);
        for (const reply of replies)
          recipients.set(
            String(reply.username),
            (recipients.get(String(reply.username)) ?? 0) + 1,
          );
        for (const [recipient, count] of recipients)
          yield this.event(
            recipient,
            `delete-review:${JSON.stringify(target)}:${review.created_at}`,
            'content-moderated',
            action,
            {
              ...payload,
              contentType: recipient === target[0] ? 'review' : 'reply',
              count,
            },
          );
        for (const reply of replies)
          yield* this.replyReportResults(String(reply.id), 'delete-reply', {
            ...payload,
            contentType: 'reply',
          });
      }
      yield {
        sql: 'DELETE FROM video_review_reply_reports WHERE reply_id IN (SELECT id FROM video_review_replies WHERE author = ? AND title_norm = ? AND year = ?)',
        params: target,
      };
      for (const table of [
        'video_review_replies',
        'video_review_likes',
        'video_review_reports',
      ])
        yield {
          sql: `DELETE FROM ${table} WHERE author = ? AND title_norm = ? AND year = ?`,
          params: target,
        };
      yield {
        sql: 'DELETE FROM video_reviews WHERE username = ? AND title_norm = ? AND year = ?',
        params: target,
      };
    } else {
      if (action === 'mark-spoiler' && !review.spoiler) {
        review.spoiler = true;
        yield {
          sql: 'UPDATE video_reviews SET review_json = ? WHERE username = ? AND title_norm = ? AND year = ?',
          params: [JSON.stringify(review), ...target],
        };
        yield this.event(
          target[0],
          `spoiler:${JSON.stringify(target)}:${review.created_at}:${review.updated_at}`,
          'content-moderated',
          action,
          payload,
        );
      }
      yield {
        sql: 'DELETE FROM video_review_reports WHERE author = ? AND title_norm = ? AND year = ?',
        params: target,
      };
    }
    return 1;
  }
  private *replyReportResults(
    id: string,
    action: string,
    payload: UserNoticePayload,
  ): Generator<NoticeStatement, void, Row[]> {
    const reports = yield this.select(
      'SELECT reporter, created_at FROM video_review_reply_reports WHERE reply_id = ?',
      [id],
    );
    for (const report of reports)
      yield this.event(
        String(report.reporter),
        `reply-report:${id}:${report.created_at}`,
        'report-result',
        action,
        payload,
      );
  }
  *reply(
    id: string,
    username: string,
    admin: boolean,
    action: 'dismiss' | 'delete-reply' = 'delete-reply',
  ): NoticeMutation {
    const rows = yield this.select(
      'SELECT id, username, title_norm, year FROM video_review_replies WHERE id = ? AND (? = 1 OR username = ?)',
      [id, admin ? 1 : 0, normalizeUsername(username)],
    );
    if (!rows.length) return 0;
    const row = rows[0];
    const payload: UserNoticePayload = {
      title: String(row.title_norm),
      year: String(row.year),
      contentType: 'reply',
      count: 1,
    };
    if (admin) {
      yield* this.replyReportResults(id, action, payload);
      if (action === 'delete-reply')
        yield this.event(
          String(row.username),
          `delete-reply:${id}`,
          'content-moderated',
          action,
          payload,
        );
    }
    yield {
      sql: 'DELETE FROM video_review_reply_reports WHERE reply_id = ?',
      params: [id],
    };
    if (action === 'delete-reply')
      yield {
        sql: 'DELETE FROM video_review_replies WHERE id = ?',
        params: [id],
      };
    return 1;
  }
  *danmaku(ids: string[]): NoticeMutation {
    if (!ids.length) return 0;
    const params = [...new Set(ids)].sort();
    const placeholders = params.map(() => '?').join(',');
    const rows = yield this.select(
      `SELECT id, username, title, year, episode_key FROM user_danmaku WHERE id IN (${placeholders}) ORDER BY id`,
      params,
    );
    const groups = new Map<string, Row[]>();
    for (const row of rows) {
      const key = JSON.stringify([
        row.username,
        row.title || row.episode_key,
        row.year,
      ]);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const group of groups.values()) {
      const row = group[0];
      yield this.event(
        String(row.username),
        `danmaku:${group
          .map((row) => row.id)
          .sort()
          .join(',')}`,
        'content-moderated',
        'delete-danmaku',
        {
          title: String(row.title),
          year: String(row.year),
          contentType: 'danmaku',
          count: group.length,
        },
      );
    }
    yield {
      sql: `DELETE FROM user_danmaku WHERE id IN (${placeholders})`,
      params,
    };
    return rows.length;
  }
}
