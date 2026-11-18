import { randomUUID } from 'crypto';

import type { CompletionSummary } from '@/features/play/lib/completion-types';
import type { MessageCursor } from '@/lib/message-cursor.server';
import { getPlayRecordEpisodeDisplay } from '@/lib/play-records';
import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';
import type { PlayRecord } from '@/lib/types';
import { normalizeUsername } from '@/lib/username';

import {
  type CapsuleInput,
  type CapsulePage,
  type DeliveredCapsule,
  type PendingCapsule,
  type TimeCapsuleUserMessage,
  CAPSULE_CONTENT_MAX_LENGTH,
  CAPSULE_MAX_DELAY_MS,
  CAPSULE_MIN_DELAY_MS,
  CAPSULE_PENDING_MAX_COUNT,
} from './types';

type Row = Record<string, string | number | null>;
type Statement = { sql: string; params: (string | number | null)[] };
type Plan<T> = Generator<Statement, T, Row[]>;
const query = (sql: string, ...params: Statement['params']): Statement => ({
  sql,
  params,
});

export class ViewingHappinessError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface ViewingHappinessStore {
  countCapsules(
    username: string,
    now?: number,
  ): Promise<{ pending: number; delivered: number; unread: number }>;
  getCompletion(
    username: string,
    key: string,
    celebrate?: boolean,
  ): Promise<CompletionSummary | null>;
  createCapsule(
    username: string,
    input: CapsuleInput,
    now?: number,
  ): Promise<PendingCapsule>;
  getCapsules(
    username: string,
    cursor?: string | null,
    now?: number,
  ): Promise<CapsulePage>;
  deleteCapsule(username: string, id: string): Promise<boolean>;
  openCapsule(
    username: string,
    id: string,
    now?: number,
  ): Promise<DeliveredCapsule | null>;
  getCapsuleMessages(
    username: string,
    limit: number,
    before?: MessageCursor | null,
    now?: number,
  ): Promise<{ items: TimeCapsuleUserMessage[]; total: number }>;
  readAllCapsules(username: string, now?: number): Promise<void>;
}

export function viewingHappinessSchema(dialect: 'sqlite' | 'mysql'): string[] {
  const time = dialect === 'mysql' ? 'BIGINT' : 'INTEGER';
  const suffix =
    dialect === 'mysql' ? ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin' : '';
  return [
    `CREATE TABLE IF NOT EXISTS work_completions (username VARCHAR(191) NOT NULL, title_norm VARCHAR(300) NOT NULL, year VARCHAR(16) NOT NULL, celebrated_at ${time} NOT NULL, PRIMARY KEY (username, title_norm, year))${suffix}`,
    `CREATE TABLE IF NOT EXISTS time_capsules (id VARCHAR(36) PRIMARY KEY, username VARCHAR(191) NOT NULL, title VARCHAR(300) NOT NULL, title_norm VARCHAR(300) NOT NULL, year VARCHAR(16) NOT NULL, cover TEXT NOT NULL, source VARCHAR(191) NOT NULL, video_id VARCHAR(300) NOT NULL, content TEXT NOT NULL, rating_then REAL, created_at ${time} NOT NULL, deliver_at ${time} NOT NULL, opened_at ${time}${dialect === 'mysql' ? ', KEY idx_capsules_owner_delivery (username, deliver_at, id), KEY idx_capsules_unread (username, opened_at, deliver_at, id)' : ''})${suffix}`,
    ...(dialect === 'sqlite'
      ? [
          'CREATE INDEX IF NOT EXISTS idx_capsules_owner_delivery ON time_capsules (username, deliver_at, id)',
          'CREATE INDEX IF NOT EXISTS idx_capsules_unread ON time_capsules (username, opened_at, deliver_at, id)',
        ]
      : []),
  ];
}

function text(
  value: unknown,
  max: number,
  label: string,
  optional = false,
): string {
  if (optional && value === undefined) return '';
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!optional && !value.trim())
  )
    throw new ViewingHappinessError(`${label}格式不正确`);
  return value.trim();
}
export function validateCapsuleInput(
  input: unknown,
  now = Date.now(),
): CapsuleInput {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new ViewingHappinessError('请求体必须为有效 JSON 对象');
  const value = input as Record<string, unknown>;
  const title = text(value.title, 300, '作品标题');
  if (!normalizeWorkTitle(title))
    throw new ViewingHappinessError('作品标题格式不正确');
  if (
    typeof value.deliverAt !== 'number' ||
    !Number.isSafeInteger(value.deliverAt) ||
    value.deliverAt < now + CAPSULE_MIN_DELAY_MS ||
    value.deliverAt > now + CAPSULE_MAX_DELAY_MS
  )
    throw new ViewingHappinessError('送达时间须在一小时后至五年内');
  return {
    title,
    year: normalizeWorkYear(text(value.year, 16, '年份', true)),
    cover: text(value.cover, 4000, '封面', true),
    source: text(value.source, 191, '来源', true),
    videoId: text(value.videoId, 300, '作品编号', true),
    content: text(value.content, CAPSULE_CONTENT_MAX_LENGTH, '正文'),
    deliverAt: value.deliverAt,
  };
}
function rating(json: Row[string] | undefined): number | null {
  if (typeof json !== 'string') return null;
  const value = JSON.parse(json) as { rating?: number | null };
  return typeof value.rating === 'number' ? value.rating : null;
}
function pending(row: Row): PendingCapsule {
  return {
    id: String(row.id),
    title: String(row.title),
    year: String(row.year),
    cover: String(row.cover),
    createdAt: Number(row.created_at),
    deliverAt: Number(row.deliver_at),
  };
}
function delivered(row: Row): DeliveredCapsule {
  return {
    ...pending(row),
    source: String(row.source),
    videoId: String(row.video_id),
    content: String(row.content),
    ratingThen: row.rating_then === null ? null : Number(row.rating_then),
    ratingNow: rating(row.rating_now_json),
    openedAt: row.opened_at === null ? null : Number(row.opened_at),
  };
}
export function capsuleMessage(
  capsule: DeliveredCapsule,
): TimeCapsuleUserMessage {
  return {
    ...capsule,
    id: `time-capsule:${capsule.id}`,
    capsuleId: capsule.id,
    type: 'time-capsule',
    writtenAt: capsule.createdAt,
    createdAt: capsule.deliverAt,
  };
}
// 精确年份记录存在时保留其空评分；只有缺记录才回落到空年份。
const CAPSULE_SELECT = `SELECT c.*, COALESCE(
  (SELECT r.review_json FROM video_reviews r WHERE r.username = c.username AND r.title_norm = c.title_norm AND r.year = c.year),
  (SELECT r.review_json FROM video_reviews r WHERE r.username = c.username AND r.title_norm = c.title_norm AND r.year = '')
) AS rating_now_json FROM time_capsules c`;

export class ViewingHappinessPlans {
  constructor(private readonly dialect: 'sqlite' | 'mysql') {}

  *countCapsules(
    user: string,
    now = Date.now(),
  ): Plan<{ pending: number; delivered: number; unread: number }> {
    const [row] = yield query(
      'SELECT COALESCE(SUM(CASE WHEN deliver_at > ? THEN 1 ELSE 0 END), 0) AS pending, COALESCE(SUM(CASE WHEN deliver_at <= ? THEN 1 ELSE 0 END), 0) AS delivered, COALESCE(SUM(CASE WHEN deliver_at <= ? AND opened_at IS NULL THEN 1 ELSE 0 END), 0) AS unread FROM time_capsules WHERE username = ?',
      now,
      now,
      now,
      normalizeUsername(user),
    );
    return {
      pending: Number(row.pending),
      delivered: Number(row.delivered),
      unread: Number(row.unread),
    };
  }

  *getCompletion(
    user: string,
    key: string,
    celebrate = false,
  ): Plan<CompletionSummary | null> {
    const username = normalizeUsername(user);
    const [row] = yield query(
      'SELECT record_json FROM play_records WHERE username = ? AND record_key = ?',
      username,
      key,
    );
    if (!row) return null;
    const record = JSON.parse(String(row.record_json)) as PlayRecord;
    const titleNorm = normalizeWorkTitle(record.title);
    const year = normalizeWorkYear(record.year);
    if (celebrate)
      yield query(
        `${this.dialect === 'mysql' ? 'INSERT IGNORE' : 'INSERT OR IGNORE'} INTO work_completions (username, title_norm, year, celebrated_at) VALUES (?, ?, ?, ?)`,
        username,
        titleNorm,
        year,
        Date.now(),
      );
    const [marker] = yield query(
      'SELECT celebrated_at FROM work_completions WHERE username = ? AND title_norm = ? AND year = ?',
      username,
      titleNorm,
      year,
    );
    // 会话标题没有身份投影，先按原始作品压缩，再用共享归一化规则合并换源记录。
    const titleColumn =
      this.dialect === 'mysql' ? 'title COLLATE utf8mb4_bin' : 'title';
    const yearColumn =
      this.dialect === 'mysql' ? 'year COLLATE utf8mb4_bin' : 'year';
    const sessions = yield query(
      `SELECT ${titleColumn} AS title, ${yearColumn} AS year, SUM(watch_seconds) AS seconds, MIN(started_at) AS first_at, MAX(ended_at) AS last_at FROM playback_sessions WHERE username = ? AND watch_seconds > 0 GROUP BY ${titleColumn}, ${yearColumn}`,
      username,
    );
    let totalWatchSeconds = 0;
    let firstWatchedAt: number | null = null;
    let lastAt = 0;
    for (const session of sessions) {
      if (
        normalizeWorkTitle(String(session.title)) !== titleNorm ||
        normalizeWorkYear(String(session.year)) !== year
      )
        continue;
      totalWatchSeconds += Number(session.seconds);
      firstWatchedAt = Math.min(
        firstWatchedAt ?? Infinity,
        Number(session.first_at),
      );
      lastAt = Math.max(lastAt, Number(session.last_at));
    }
    return {
      title: record.title,
      year,
      cover: record.cover,
      episodes: getPlayRecordEpisodeDisplay(record).totalEpisodes,
      totalWatchSeconds,
      firstWatchedAt,
      completedAt: Math.max(record.save_time, lastAt),
      celebrated: !!marker,
    };
  }

  *createCapsule(
    user: string,
    raw: CapsuleInput,
    now = Date.now(),
  ): Plan<PendingCapsule> {
    const username = normalizeUsername(user);
    const input = validateCapsuleInput(raw, now);
    // 借用每用户消息状态行作为 MySQL 的并发锁，也覆盖没有 users 行的站长。
    if (this.dialect === 'mysql') {
      yield query(
        "INSERT IGNORE INTO user_message_state (username, state_json) VALUES (?, '{}')",
        username,
      );
      yield query(
        'SELECT username FROM user_message_state WHERE username = ? FOR UPDATE',
        username,
      );
    }
    const [count] = yield query(
      'SELECT COUNT(*) AS total FROM time_capsules WHERE username = ? AND deliver_at > ?',
      username,
      now,
    );
    if (Number(count.total) >= CAPSULE_PENDING_MAX_COUNT)
      throw new ViewingHappinessError('待送达的观后信已达上限', 409);
    const titleNorm = normalizeWorkTitle(input.title);
    const [review] = yield query(
      "SELECT review_json FROM video_reviews WHERE username = ? AND title_norm = ? AND year IN (?, '') ORDER BY CASE WHEN year = ? THEN 0 ELSE 1 END LIMIT 1",
      username,
      titleNorm,
      input.year,
      input.year,
    );
    const id = randomUUID();
    yield query(
      'INSERT INTO time_capsules (id, username, title, title_norm, year, cover, source, video_id, content, rating_then, created_at, deliver_at, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
      id,
      username,
      input.title,
      titleNorm,
      input.year,
      input.cover,
      input.source,
      input.videoId,
      input.content,
      rating(review?.review_json),
      now,
      input.deliverAt,
    );
    return {
      id,
      title: input.title,
      year: input.year,
      cover: input.cover,
      createdAt: now,
      deliverAt: input.deliverAt,
    };
  }

  *getCapsules(
    user: string,
    cursor?: string | null,
    now = Date.now(),
  ): Plan<CapsulePage> {
    const username = normalizeUsername(user);
    let before: { at: number; id: string } | null = null;
    if (cursor) {
      try {
        before = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as {
          at: number;
          id: string;
        };
      } catch {
        throw new ViewingHappinessError('观后信分页参数不正确');
      }
      if (
        !before ||
        !Number.isSafeInteger(before.at) ||
        typeof before.id !== 'string' ||
        before.id.length > 36
      )
        throw new ViewingHappinessError('观后信分页参数不正确');
    }
    const pendingRows = yield query(
      'SELECT id, title, year, cover, created_at, deliver_at FROM time_capsules WHERE username = ? AND deliver_at > ? ORDER BY deliver_at, id',
      username,
      now,
    );
    const rows = yield query(
      `${CAPSULE_SELECT} WHERE c.username = ? AND c.deliver_at <= ? ${before ? 'AND (c.deliver_at < ? OR (c.deliver_at = ? AND c.id < ?))' : ''} ORDER BY c.deliver_at DESC, c.id DESC LIMIT 51`,
      username,
      now,
      ...(before ? [before.at, before.at, before.id] : []),
    );
    const page = rows.slice(0, 50);
    const last = page[page.length - 1];
    return {
      pending: pendingRows.map(pending),
      delivered: page.map(delivered),
      nextCursor:
        rows.length > 50
          ? Buffer.from(
              JSON.stringify({ at: Number(last.deliver_at), id: last.id }),
            ).toString('base64url')
          : null,
    };
  }

  *deleteCapsule(user: string, id: string): Plan<boolean> {
    const username = normalizeUsername(user);
    const [row] = yield query(
      'SELECT id FROM time_capsules WHERE username = ? AND id = ?',
      username,
      id,
    );
    if (!row) return false;
    yield query(
      'DELETE FROM time_capsules WHERE username = ? AND id = ?',
      username,
      id,
    );
    return true;
  }

  *openCapsule(
    user: string,
    id: string,
    now = Date.now(),
  ): Plan<DeliveredCapsule | null> {
    const username = normalizeUsername(user);
    yield query(
      'UPDATE time_capsules SET opened_at = COALESCE(opened_at, ?) WHERE username = ? AND id = ? AND deliver_at <= ?',
      now,
      username,
      id,
      now,
    );
    const [row] = yield query(
      `${CAPSULE_SELECT} WHERE c.username = ? AND c.id = ? AND c.deliver_at <= ?`,
      username,
      id,
      now,
    );
    return row ? delivered(row) : null;
  }

  *getCapsuleMessages(
    user: string,
    limit: number,
    before?: MessageCursor | null,
    now = Date.now(),
  ): Plan<{ items: TimeCapsuleUserMessage[]; total: number }> {
    const username = normalizeUsername(user);
    const where =
      'c.username = ? AND c.deliver_at <= ? AND c.opened_at IS NULL';
    const [count] = yield query(
      `SELECT COUNT(*) AS total FROM time_capsules c WHERE ${where}`,
      username,
      now,
    );
    const sortKey =
      this.dialect === 'mysql'
        ? "CONCAT('time-capsule:', c.id)"
        : "('time-capsule:' || c.id)";
    const rows = yield query(
      `${CAPSULE_SELECT} WHERE ${where} ${before ? `AND (c.deliver_at < ? OR (c.deliver_at = ? AND ${sortKey} < ?))` : ''} ORDER BY c.deliver_at DESC, c.id DESC LIMIT ?`,
      username,
      now,
      ...(before ? [before.createdAt, before.createdAt, before.key] : []),
      limit,
    );
    return {
      items: rows.map((row) => capsuleMessage(delivered(row))),
      total: Number(count.total),
    };
  }

  *readAllCapsules(user: string, now = Date.now()): Plan<void> {
    yield query(
      'UPDATE time_capsules SET opened_at = ? WHERE username = ? AND deliver_at <= ? AND opened_at IS NULL',
      now,
      normalizeUsername(user),
      now,
    );
  }
}
