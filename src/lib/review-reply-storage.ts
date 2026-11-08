import { randomUUID } from 'crypto';

import type { FollowReviewQuery } from '@/lib/follow-review-identity';
import type { ReviewReplyUserMessage } from '@/lib/message-types';
import { publicUserRole } from '@/lib/public-user-role.server';
import type { SocialExecutor } from '@/lib/review-social-storage';
import type {
  PublicReviewReply,
  ReviewReportReason,
  VideoReview,
} from '@/lib/types';
import { normalizeUsername } from '@/lib/username';
import {
  REVIEW_REPLY_MAX_LENGTH,
  ReviewValidationError,
} from '@/lib/video-reviews';

export interface ReviewReplyRow {
  id: string;
  author: string;
  title_norm: string;
  year: string;
  username: string;
  reply_to: string | null;
  content: string;
  created_at: number;
}

type PublicReplyRow = ReviewReplyRow & {
  profile_id: string;
  nickname: string | null;
  avatar_seed: string | null;
  access_role: string | null;
  reply_profile_id: string | null;
  reply_nickname: string | null;
  review_json: string;
  review_profile_id: string;
};

export const REPLY_COLUMNS =
  'id, author, title_norm, year, username, reply_to, content, created_at';
export function replySchema(dialect: 'sqlite' | 'mysql'): string[] {
  const text = dialect === 'sqlite' ? 'TEXT' : 'VARCHAR(191)';
  const time = dialect === 'sqlite' ? 'INTEGER' : 'BIGINT';
  const suffix =
    dialect === 'mysql' ? ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin' : '';
  return [
    `CREATE TABLE IF NOT EXISTS video_review_replies (id VARCHAR(36) NOT NULL PRIMARY KEY, author ${text} NOT NULL, title_norm ${text} NOT NULL, year VARCHAR(16) NOT NULL, username ${text} NOT NULL, reply_to ${text}, content VARCHAR(300) NOT NULL, created_at ${time} NOT NULL${dialect === 'mysql' ? ', KEY idx_review_replies_target (author, title_norm, year, created_at, id), KEY idx_review_replies_recipient (reply_to, created_at, id), KEY idx_review_replies_user (username)' : ''})${suffix}`,
    `CREATE TABLE IF NOT EXISTS video_review_reply_reports (reply_id VARCHAR(36) NOT NULL, reporter ${text} NOT NULL, reason VARCHAR(16) NOT NULL, detail VARCHAR(200) NOT NULL, created_at ${time} NOT NULL, PRIMARY KEY (reply_id, reporter))${suffix}`,
    ...(dialect === 'sqlite'
      ? [
          'CREATE INDEX IF NOT EXISTS idx_review_replies_target ON video_review_replies (author, title_norm, year, created_at, id)',
          'CREATE INDEX IF NOT EXISTS idx_review_replies_recipient ON video_review_replies (reply_to, created_at, id)',
          'CREATE INDEX IF NOT EXISTS idx_review_replies_user ON video_review_replies (username)',
        ]
      : []),
  ];
}

export function validateReplyContent(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > REVIEW_REPLY_MAX_LENGTH
  )
    throw new ReviewValidationError(
      `回复内容须为 1–${REVIEW_REPLY_MAX_LENGTH} 字`,
    );
  return value.trim();
}

export function replyMessageId(id: string, createdAt: number): string {
  return `review-reply:${createdAt}:${id}`;
}
export function parseReplyMessageId(
  value: string,
): { id: string; createdAt: number } | null {
  const match = /^review-reply:(\d+):([a-f0-9-]{36})$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1]))) return null;
  return { id: match[2], createdAt: Number(match[1]) };
}

function publicReply(row: PublicReplyRow, viewer: string): PublicReviewReply {
  const role = publicUserRole(row.username, row.access_role);
  return {
    id: row.id,
    author: {
      profileId: row.profile_id,
      nickname: row.nickname,
      avatarSeed: row.avatar_seed,
      ...(role ? { role } : {}),
    },
    replyTo: row.reply_profile_id
      ? { profileId: row.reply_profile_id, nickname: row.reply_nickname }
      : null,
    content: row.content,
    created_at: Number(row.created_at),
    isMine: row.username === normalizeUsername(viewer),
  };
}

const REPLY_FROM = `FROM video_review_replies r JOIN video_reviews v ON v.username = r.author AND v.title_norm = r.title_norm AND v.year = r.year
 JOIN user_profiles owner ON owner.username = r.author JOIN user_profiles p ON p.username = r.username LEFT JOIN user_profiles t ON t.username = r.reply_to LEFT JOIN user_access a ON a.username = r.username`;
const REPLY_SELECT =
  'r.*, v.review_json, owner.profile_id AS review_profile_id, p.profile_id, p.nickname, p.avatar_seed, a.role AS access_role, t.profile_id AS reply_profile_id, t.nickname AS reply_nickname';

export class ReviewReplyStorage {
  constructor(protected readonly sql: SocialExecutor) {}

  async getPublicReplyById(
    id: string,
    viewer: string,
  ): Promise<PublicReviewReply | null> {
    const [row] = await this.sql.rows<PublicReplyRow>(
      `SELECT ${REPLY_SELECT} ${REPLY_FROM} WHERE r.id = ? AND v.is_public = 1`,
      [id],
    );
    return row ? publicReply(row, viewer) : null;
  }

  async getReviewReplies(
    author: string,
    title: string,
    year: string,
    viewer: string,
    cursor?: string,
  ): Promise<{ items: PublicReviewReply[]; nextCursor: string | null }> {
    let after: [number, string] | null = null;
    if (cursor) {
      try {
        if (cursor.length > 2000 || !/^[\w-]+$/.test(cursor)) throw new Error();
        const value = JSON.parse(
          Buffer.from(cursor, 'base64url').toString('utf8'),
        );
        if (
          !Array.isArray(value) ||
          value.length !== 3 ||
          value[0] !== 'replies-v1' ||
          !Number.isSafeInteger(value[1]) ||
          value[1] < 0 ||
          typeof value[2] !== 'string' ||
          !/^[a-f0-9-]{36}$/.test(value[2])
        )
          throw new Error();
        after = [value[1], value[2]];
      } catch {
        throw new ReviewValidationError('回复分页游标无效');
      }
    }
    const rows = await this.sql.rows<PublicReplyRow>(
      `SELECT ${REPLY_SELECT} ${REPLY_FROM} WHERE v.is_public = 1 AND r.author = ? AND r.title_norm = ? AND r.year = ? ${after ? 'AND (r.created_at > ? OR (r.created_at = ? AND r.id > ?))' : ''} ORDER BY r.created_at ASC, r.id ASC LIMIT 21`,
      [
        normalizeUsername(author),
        title,
        year,
        ...(after ? [after[0], after[0], after[1]] : []),
      ],
    );
    const items = rows.slice(0, 20).map((row) => publicReply(row, viewer));
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > 20 && last
          ? Buffer.from(
              JSON.stringify(['replies-v1', last.created_at, last.id]),
            ).toString('base64url')
          : null,
    };
  }

  async postReviewReply(
    author: string,
    title: string,
    year: string,
    username: string,
    content: string,
    replyToId?: string,
  ): Promise<PublicReviewReply | null> {
    content = validateReplyContent(content);
    author = normalizeUsername(author);
    username = normalizeUsername(username);
    const id = randomUUID();
    const createdAt = Date.now();
    // 单条 INSERT SELECT 同时复核公开状态和被回复者归属，避免预检之后评价变为私密。
    const changed = await this.sql.run(
      `INSERT INTO video_review_replies (${REPLY_COLUMNS}) SELECT ?, v.username, v.title_norm, v.year, ?, ${replyToId ? 't.username' : 'NULL'}, ?, ? FROM video_reviews v ${replyToId ? 'JOIN video_review_replies t ON t.author = v.username AND t.title_norm = v.title_norm AND t.year = v.year AND t.id = ?' : ''} WHERE v.username = ? AND v.title_norm = ? AND v.year = ? AND v.is_public = 1`,
      [
        id,
        username,
        content,
        createdAt,
        ...(replyToId ? [replyToId] : []),
        author,
        title,
        year,
      ],
    );
    if (!changed) {
      if (replyToId)
        throw new ReviewValidationError('被回复内容不存在或不属于该公开评价');
      return null;
    }
    const [row] = await this.sql.rows<PublicReplyRow>(
      `SELECT ${REPLY_SELECT} ${REPLY_FROM} WHERE r.id = ? AND v.is_public = 1`,
      [id],
    );
    return row ? publicReply(row, username) : null;
  }

  async reportReviewReply(
    id: string,
    reporter: string,
    reason: ReviewReportReason,
    detail: string,
  ): Promise<boolean> {
    reporter = normalizeUsername(reporter);
    const conflict =
      this.sql.dialect === 'sqlite'
        ? 'ON CONFLICT(reply_id, reporter) DO UPDATE SET reason = excluded.reason, detail = excluded.detail, created_at = excluded.created_at'
        : 'ON DUPLICATE KEY UPDATE reason = VALUES(reason), detail = VALUES(detail), created_at = VALUES(created_at)';
    return (
      (await this.sql.run(
        `INSERT INTO video_review_reply_reports (reply_id, reporter, reason, detail, created_at) SELECT r.id, ?, ?, ?, ? ${REPLY_FROM} WHERE r.id = ? AND r.username <> ? AND v.is_public = 1 ${conflict}`,
        [reporter, reason, detail, Date.now(), id, reporter],
      )) > 0
    );
  }

  private replyMessageWhere(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
  ) {
    const ids = readIds.map(parseReplyMessageId).filter((id) => id !== null);
    username = normalizeUsername(username);
    return {
      from: `${REPLY_FROM} WHERE v.is_public = 1 AND (r.author = ? OR r.reply_to = ?) AND r.username <> ? AND r.created_at > ? ${ids.length ? `AND r.id NOT IN (${ids.map(() => '?').join(',')})` : ''}`,
      params: [
        username,
        username,
        username,
        Math.max(readAt, now - 30 * 86400000),
        ...ids.map((item) => item.id),
      ] as unknown[],
    };
  }

  async getReviewReplyMessageCount(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
  ): Promise<number> {
    const { from, params } = this.replyMessageWhere(
      username,
      readAt,
      readIds,
      now,
    );
    const [row] = await this.sql.rows<{ count: number }>(
      `SELECT COUNT(*) AS count ${from}`,
      params,
    );
    return Number(row.count);
  }

  async getReviewReplyMessages(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
    query: FollowReviewQuery = {},
  ): Promise<ReviewReplyUserMessage[]> {
    const { from, params } = this.replyMessageWhere(
      username,
      readAt,
      readIds,
      now,
    );
    let filter = '';
    if (query.id) {
      const identity = parseReplyMessageId(query.id);
      if (!identity) return [];
      filter += ' AND r.id = ? AND r.created_at = ?';
      params.push(identity.id, identity.createdAt);
    }
    if (query.before) {
      const { key, createdAt } = query.before;
      if (key.startsWith('review-reply:')) {
        filter += ' AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?))';
        params.push(createdAt, createdAt, key.slice('review-reply:'.length));
      } else {
        filter +=
          key > 'review-reply:'
            ? ' AND r.created_at <= ?'
            : ' AND r.created_at < ?';
        params.push(createdAt);
      }
    }
    const rows = await this.sql.rows<PublicReplyRow>(
      `SELECT ${REPLY_SELECT} ${from}${filter} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
      [...params, Math.max(1, Math.min(201, Math.floor(query.limit ?? 30)))],
    );
    return rows.map((row) => {
      const review = JSON.parse(row.review_json) as VideoReview;
      return {
        id: replyMessageId(row.id, Number(row.created_at)),
        type: 'review-reply',
        replyId: row.id,
        review: {
          profileId: row.review_profile_id,
          title_norm: row.title_norm,
          year: row.year,
        },
        author: publicReply(row, username).author,
        title: review.title,
        year: review.year,
        cover: review.cover,
        content: row.content,
        createdAt: Number(row.created_at),
      };
    });
  }
}
