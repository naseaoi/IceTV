import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';
import type {
  AdminVideoReviewPage,
  PublicUserRef,
  PublicVideoReview,
  VideoReview,
} from '@/lib/types';
import { type WatchLevel, watchLevelForMs } from '@/lib/watch-level';

// 前后端共用；存储列为 MEDIUMTEXT，放宽上限无需迁移
export const REVIEW_CONTENT_MAX_LENGTH = 5000;
export const REVIEW_REPLY_MAX_LENGTH = 300;
export const MY_REVIEWS_PAGE_SIZE = 20;
export const WORK_REVIEWS_PAGE_SIZE = 20;
export const VIDEO_REVIEWS_UPDATED_EVENT = 'videoReviewsUpdated';

export type MyReviewFilter = 'all' | 'public' | 'private' | 'text';
export type MyReviewSort = 'updated' | 'high' | 'low';
export interface MyReviewQuery {
  cursor?: string;
  q?: string;
  filter?: MyReviewFilter;
  sort?: MyReviewSort;
}

export function validateMyReviewQuery(query: MyReviewQuery) {
  const q = text(query.q ?? '', '搜索关键词', 200);
  const filter = query.filter ?? 'all';
  const sort = query.sort ?? 'updated';
  if (
    !['all', 'public', 'private', 'text'].includes(filter) ||
    !['updated', 'high', 'low'].includes(sort)
  )
    throw new ReviewValidationError('评价筛选或排序无效');
  const after = decodeReviewCursor(query.cursor);
  if (
    after &&
    (!/^\d+$/.test(after[1]) || !Number.isSafeInteger(Number(after[1])))
  )
    throw new ReviewValidationError('分页游标无效');
  return { q, filter, sort, after };
}

export class ReviewValidationError extends Error {}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length > max) {
    throw new ReviewValidationError(`${label}格式无效，最多 ${max} 字`);
  }
  return value.trim();
}

export function reviewIdentity(title: unknown, year: unknown) {
  const displayTitle = text(title, '标题', 200);
  const title_norm = normalizeWorkTitle(displayTitle);
  if (!title_norm || title_norm.length > 191) {
    throw new ReviewValidationError('标题不能为空，归一化后最多 191 字');
  }
  const normalizedYear = normalizeWorkYear(text(year ?? '', '年份', 16));
  return { title: displayTitle, title_norm, year: normalizedYear };
}

export function reviewInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReviewValidationError('评价格式无效');
  }
  const input = value as Record<string, unknown>;
  const identity = reviewIdentity(input.title, input.year);
  const rating = input.rating;
  if (
    rating !== null &&
    (typeof rating !== 'number' ||
      !Number.isFinite(rating) ||
      rating < 1 ||
      rating > 10)
  ) {
    throw new ReviewValidationError('评分必须为 1–10 的有限数或 null');
  }
  const content = text(input.content, '评价内容', REVIEW_CONTENT_MAX_LENGTH);
  if (rating === null && !content)
    throw new ReviewValidationError('评分与评价内容至少填写一项');
  if (typeof input.is_public !== 'boolean')
    throw new ReviewValidationError('公开状态必须为布尔值');
  if (input.spoiler !== undefined && typeof input.spoiler !== 'boolean')
    throw new ReviewValidationError('剧透状态必须为布尔值');
  const douban_id = input.douban_id ?? 0;
  if (
    typeof douban_id !== 'number' ||
    !Number.isSafeInteger(douban_id) ||
    douban_id < 0
  ) {
    throw new ReviewValidationError('豆瓣 ID 格式无效');
  }
  return {
    ...identity,
    rating: rating === null ? null : Math.round(rating * 10) / 10,
    content,
    is_public: input.is_public,
    spoiler: input.spoiler === true,
    cover: text(input.cover, '封面地址', 1000),
    source_key: text(input.source_key, '来源标识', 300),
    douban_id,
  };
}

export type ReviewCursor = [number, string, string, string];

export function decodeReviewCursor(cursor?: string): ReviewCursor | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 3000 || !/^[A-Za-z0-9_-]+$/.test(cursor))
      throw new Error();
    const value: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (
      !Array.isArray(value) ||
      value.length !== 4 ||
      !Number.isSafeInteger(value[0]) ||
      value[0] < 0 ||
      typeof value[1] !== 'string' ||
      !value[1] ||
      value[1].length > 191 ||
      typeof value[2] !== 'string' ||
      !value[2] ||
      value[2].length > 191 ||
      typeof value[3] !== 'string' ||
      value[3].length > 16
    )
      throw new Error();
    return value as ReviewCursor;
  } catch {
    throw new ReviewValidationError('分页游标无效');
  }
}

export function decodeWorkReviewCursor(
  cursor: string | undefined,
  viewer: string,
  title: string,
  year: string,
): { followed: number; time: number; profileId: string; year: string } | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 3000 || !/^[\w-]+$/.test(cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      !Array.isArray(value) ||
      value.length !== 8 ||
      value[0] !== 'work-v2' ||
      value[1] !== viewer ||
      value[2] !== title ||
      value[3] !== year ||
      ![0, 1].includes(value[4]) ||
      !Number.isSafeInteger(value[5]) ||
      value[5] < 0 ||
      typeof value[6] !== 'string' ||
      !/^[a-zA-Z0-9]{12}$/.test(value[6]) ||
      typeof value[7] !== 'string' ||
      value[7].length > 16
    )
      throw new Error();
    return {
      followed: value[4],
      time: value[5],
      profileId: value[6],
      year: value[7],
    };
  } catch {
    throw new ReviewValidationError('分页游标已失效，请重新加载');
  }
}

export function reviewPageParams(cursor?: string, q = '') {
  const keyword = text(q, '搜索关键词', 200);
  const after = decodeReviewCursor(cursor);
  const [time, username, title, year] = after ?? [0, '', '', ''];
  const pattern = `%${keyword.replace(/[!%_]/g, '!$&')}%`;
  return [
    keyword,
    pattern,
    pattern,
    after ? 1 : 0,
    time,
    time,
    username,
    username,
    title,
    title,
    year,
  ];
}

export type VideoReviewRow = {
  level?: WatchLevel;
  counted_ms?: number | null;
  username: string;
  review_json: string;
  profile_id?: string;
  nickname?: string | null;
  avatar_seed?: string | null;
  role?: PublicUserRef['role'];
  like_count?: number;
  reply_count?: number;
  liked_by_me?: boolean;
  author_followed?: boolean;
};

export function publicReview(row: VideoReviewRow): PublicVideoReview {
  const review = JSON.parse(row.review_json) as VideoReview;
  return {
    author: {
      profileId: row.profile_id ?? '',
      nickname: row.nickname ?? null,
      avatarSeed: row.avatar_seed ?? null,
      level: row.level ?? watchLevelForMs(Number(row.counted_ms ?? 0)),
      ...(row.role ? { role: row.role } : {}),
    },
    authorFollowed: row.author_followed ?? false,
    title_norm: review.title_norm,
    spoiler: review.spoiler === true,
    likeCount: row.like_count ?? 0,
    replyCount: row.reply_count ?? 0,
    likedByMe: row.liked_by_me ?? false,
    title: review.title,
    year: review.year,
    cover: review.cover,
    rating: review.rating,
    content: review.content,
    created_at: review.created_at,
    updated_at: review.updated_at,
  };
}

export function reviewPage(rows: VideoReviewRow[]): AdminVideoReviewPage {
  const items = rows.slice(0, 30).map((row) => ({
    ...publicReview(row),
    username: row.username,
    title_norm: (JSON.parse(row.review_json) as VideoReview).title_norm,
  }));
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > 30 && last
        ? Buffer.from(
            JSON.stringify([
              last.updated_at,
              last.username,
              last.title_norm,
              last.year,
            ]),
          ).toString('base64url')
        : null,
  };
}

export function reviewSql(dialect: 'sqlite' | 'mysql') {
  const title =
    dialect === 'sqlite'
      ? "json_extract(review_json, '$.title')"
      : "JSON_UNQUOTE(JSON_EXTRACT(review_json, '$.title'))";
  const rating =
    dialect === 'sqlite'
      ? "json_extract(review_json, '$.rating')"
      : "CASE WHEN JSON_TYPE(JSON_EXTRACT(review_json, '$.rating')) = 'NULL' THEN NULL ELSE CAST(JSON_UNQUOTE(JSON_EXTRACT(review_json, '$.rating')) AS DECIMAL(10, 2)) END";
  const workWhere =
    "title_norm = ? AND is_public = 1 AND (? = '' OR year IN (?, ''))";
  return {
    rating,
    title,
    own: `SELECT review_json FROM video_reviews WHERE username = ? AND title_norm = ? AND (? = '' OR year IN (?, '')) ORDER BY CASE WHEN year = ? THEN 1 ELSE 0 END DESC, updated_at DESC, year DESC LIMIT 1`,
    latest:
      'SELECT review_json FROM video_reviews WHERE username = ? AND title_norm = ? ORDER BY updated_at DESC, year DESC LIMIT 1',
    all: 'SELECT review_json FROM video_reviews WHERE username = ? ORDER BY updated_at DESC, title_norm DESC, year DESC',
    delete:
      'DELETE FROM video_reviews WHERE username = ? AND title_norm = ? AND year = ? AND (? = 0 OR is_public = 1)',
    work: `SELECT username, review_json FROM video_reviews WHERE ${workWhere} ORDER BY updated_at DESC, username DESC, year DESC LIMIT 50`,
    distribution: `SELECT ${dialect === 'sqlite' ? `CAST(${rating} AS INTEGER)` : `FLOOR(${rating})`} AS bucket, COUNT(*) AS count FROM video_reviews WHERE ${workWhere} AND ${rating} IS NOT NULL GROUP BY bucket`,
    summary: `SELECT AVG(${rating}) AS average, COUNT(${rating}) AS count FROM video_reviews WHERE ${workWhere}`,
    page: `SELECT username, review_json FROM video_reviews WHERE is_public = 1
      AND (? = '' OR LOWER(${title}) LIKE LOWER(?) ESCAPE '!' OR LOWER(username) LIKE LOWER(?) ESCAPE '!')
      AND (? = 0 OR updated_at < ? OR (updated_at = ? AND (username < ? OR (username = ? AND (title_norm < ? OR (title_norm = ? AND year < ?))))))
      ORDER BY updated_at DESC, username DESC, title_norm DESC, year DESC LIMIT 31`,
  };
}
