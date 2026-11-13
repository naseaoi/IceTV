import type { AnnualActivityData } from '@/features/playback-stats/types';
import { normalizeUsername } from '@/lib/username';

type Row = Record<string, string | number | null>;
type Statement = { sql: string; params: (string | number | null)[] };
const query = (sql: string, ...params: Statement['params']): Statement => ({
  sql,
  params,
});

// 两后端共用谓词；只读元数据，观后信正文始终留在存储边界内。
export function* annualActivityPlan(
  dialect: 'sqlite' | 'mysql',
  user: string,
  start: number,
  end: number,
): Generator<Statement, AnnualActivityData, Row[]> {
  const username = normalizeUsername(user);
  const completions = yield query(
    'SELECT title_norm, year, celebrated_at FROM work_completions WHERE username = ? AND celebrated_at >= ? AND celebrated_at < ?',
    username,
    start,
    end,
  );
  const binary = (column: string) =>
    dialect === 'mysql' ? `${column} COLLATE utf8mb4_bin` : column;
  // 会话没有归一化身份投影。跨年历史先按原始元数据压缩，再由纯函数合并换源身份。
  const watches = completions.length
    ? yield query(
        `SELECT ${binary('title')} AS title, ${binary('year')} AS year, ${binary('cover')} AS cover, MIN(started_at) AS first_at, MAX(started_at) AS last_at FROM playback_sessions WHERE username = ? AND started_at < ? AND watch_seconds > 0 GROUP BY ${binary('title')}, ${binary('year')}, ${binary('cover')}`,
        username,
        end,
      )
    : [];
  const lists = yield query(
    'SELECT id, name, is_public, created_at, updated_at, item_count FROM user_lists WHERE username = ? AND created_at < ?',
    username,
    end,
  );
  // 年内条目用于计数；顺序前三项用于封面，不受添加年份限制。
  const items = yield query(
    `SELECT list_id, cover, position, added_at FROM (SELECT i.list_id, i.cover, i.position, i.added_at, ROW_NUMBER() OVER (PARTITION BY i.list_id ORDER BY i.position, i.id) AS rn FROM user_list_items i JOIN user_lists l ON l.id = i.list_id WHERE l.username = ? AND l.created_at < ?) ranked WHERE (added_at >= ? AND added_at < ?) OR rn <= 3`,
    username,
    end,
    start,
    end,
  );
  const likes = yield query(
    'SELECT k.list_id, k.created_at FROM list_likes k JOIN user_lists l ON l.id = k.list_id WHERE l.username = ? AND k.created_at >= ? AND k.created_at < ?',
    username,
    start,
    end,
  );
  const capsules = yield query(
    'SELECT title, year, cover, created_at, deliver_at, rating_then FROM time_capsules WHERE username = ? AND ((created_at >= ? AND created_at < ?) OR (deliver_at >= ? AND deliver_at < ?))',
    username,
    start,
    end,
    start,
    end,
  );
  const follows = yield query(
    'SELECT created_at FROM user_follows WHERE follower = ? AND created_at >= ? AND created_at < ?',
    username,
    start,
    end,
  );
  return {
    completions: completions.map((r) => ({
      titleNorm: String(r.title_norm),
      year: String(r.year),
      celebratedAt: Number(r.celebrated_at),
    })),
    completionWatches: watches.map((r) => ({
      title: String(r.title),
      year: String(r.year),
      cover: String(r.cover),
      firstAt: Number(r.first_at),
      lastAt: Number(r.last_at),
    })),
    lists: lists.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      visibility: Number(r.is_public),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      itemCount: Number(r.item_count),
    })),
    listItems: items.map((r) => ({
      listId: String(r.list_id),
      cover: String(r.cover),
      position: Number(r.position),
      addedAt: Number(r.added_at),
    })),
    likes: likes.map((r) => ({
      listId: String(r.list_id),
      createdAt: Number(r.created_at),
    })),
    capsules: capsules.map((r) => ({
      title: String(r.title),
      year: String(r.year),
      cover: String(r.cover),
      createdAt: Number(r.created_at),
      deliverAt: Number(r.deliver_at),
      ratingThen: r.rating_then === null ? null : Number(r.rating_then),
    })),
    follows: follows.map((r) => ({ createdAt: Number(r.created_at) })),
  };
}
