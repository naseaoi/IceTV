import { createHash, randomInt } from 'crypto';

import {
  profileFavoriteOriginSql,
  workStatusSelection,
} from '@/features/favorites/lib/library-storage';
import {
  annualRecapSchema,
  AnnualRecapStorage,
} from '@/lib/annual-recap-storage';
import {
  type FollowReviewQuery,
  followReviewMessageId,
  parseFollowReviewMessageId,
  parseFollowReviewSortKey,
} from '@/lib/follow-review-identity';
import type { FollowReviewUserMessage } from '@/lib/message-types';
import { publicUserRole } from '@/lib/public-user-role.server';
import { replySchema, ReviewReplyStorage } from '@/lib/review-reply-storage';
import { SocialNotificationStorage } from '@/lib/social-notification-storage';
import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';
import type { IStorage } from '@/lib/types';
import type {
  AdminReviewReportPage,
  FollowListPage,
  LibraryVisibility,
  MyVideoReviewPage,
  PublicVideoReviewPage,
  ReviewReportReason,
  UserProfile,
  UserProfileView,
  UserSocialData,
  VideoReview,
  VideoReviewRating,
  WorkReviewSummary,
} from '@/lib/types';
import { REVIEW_REPORT_REASONS } from '@/lib/types';
import {
  validateAvatarSeed,
  validateLibraryVisibility,
  validateNickname,
} from '@/lib/user-profile';
import { normalizeUsername } from '@/lib/username';
import {
  type MyReviewQuery,
  type VideoReviewRow,
  decodeWorkReviewCursor,
  MY_REVIEWS_PAGE_SIZE,
  publicReview,
  reviewSql,
  ReviewValidationError,
  validateMyReviewQuery,
  WORK_REVIEWS_PAGE_SIZE,
} from '@/lib/video-reviews';
import { tasteMatchScore } from '@/lib/viewing-insights';

export class NicknameTakenError extends Error {
  constructor() {
    super('昵称已被使用');
  }
}

export function newProfileId(): string {
  const alphabet =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  return Array.from({ length: 12 }, () => alphabet[randomInt(62)]).join('');
}

export function socialSchema(dialect: 'sqlite' | 'mysql'): string[] {
  const text = dialect === 'sqlite' ? 'TEXT' : 'VARCHAR(191)';
  const time = dialect === 'sqlite' ? 'INTEGER' : 'BIGINT';
  const suffix =
    dialect === 'mysql' ? ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin' : '';
  return [
    ...replySchema(dialect),
    annualRecapSchema(dialect),
    `CREATE TABLE IF NOT EXISTS user_profiles (username ${text} NOT NULL PRIMARY KEY, profile_id VARCHAR(12) NOT NULL UNIQUE, nickname VARCHAR(64), nickname_norm VARCHAR(64) UNIQUE, avatar_seed VARCHAR(24), favorites_public INTEGER NOT NULL DEFAULT 0, updated_at ${time} NOT NULL)${suffix}`,
    `CREATE TABLE IF NOT EXISTS user_follows (follower ${text} NOT NULL, followee ${text} NOT NULL, created_at ${time} NOT NULL, PRIMARY KEY (follower, followee)${dialect === 'mysql' ? ', KEY idx_user_follows_followee (followee)' : ''})${suffix}`,
    ...['likes', 'reports'].map((kind) => {
      const actor = kind === 'likes' ? 'liker' : 'reporter';
      return `CREATE TABLE IF NOT EXISTS video_review_${kind} (author ${text} NOT NULL, title_norm ${text} NOT NULL, year VARCHAR(16) NOT NULL, ${actor} ${text} NOT NULL, ${kind === 'reports' ? 'reason VARCHAR(16) NOT NULL, detail VARCHAR(200) NOT NULL, ' : ''}created_at ${time} NOT NULL, PRIMARY KEY (author, title_norm, year, ${actor})${dialect === 'mysql' ? `, KEY idx_review_${kind} (${kind === 'likes' ? actor : 'created_at'})` : ''})${suffix}`;
    }),
    ...(dialect === 'sqlite'
      ? [
          'CREATE INDEX IF NOT EXISTS idx_user_follows_followee ON user_follows (followee)',
          'CREATE INDEX IF NOT EXISTS idx_follow_notifications ON user_follows (followee, created_at, follower)',
          'CREATE INDEX IF NOT EXISTS idx_like_notifications ON video_review_likes (author, created_at, title_norm, year)',
          'CREATE INDEX IF NOT EXISTS idx_review_likes ON video_review_likes (liker)',
          'CREATE INDEX IF NOT EXISTS idx_review_reports ON video_review_reports (created_at)',
        ]
      : []),
  ];
}

export type SocialRow = Record<string, unknown>;
export interface SocialExecutor {
  dialect: 'sqlite' | 'mysql';
  rows<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<number>;
}

export function profileFromRow(row: UserProfile): UserProfile {
  return {
    username: row.username,
    profile_id: row.profile_id,
    nickname: row.nickname,
    avatar_seed: row.avatar_seed,
    favorites_public: validateLibraryVisibility(Number(row.favorites_public)),
    updated_at: Number(row.updated_at),
  };
}

export function socialCursor(value: unknown[]): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
export function parseSocialCursor(cursor?: string): [number, string] | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 4000 || !/^[\w-]+$/.test(cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      !Number.isSafeInteger(value[0]) ||
      value[0] < 0 ||
      typeof value[1] !== 'string'
    )
      throw new Error();
    return value as [number, string];
  } catch {
    throw new ReviewValidationError('分页游标无效');
  }
}

export function socialPage<T>(
  items: T[],
  limit: number,
  cursor: string | undefined,
  position: (item: T) => [number, string],
) {
  const after = parseSocialCursor(cursor);
  const sorted = items.sort((a, b) => {
    const [at, ak] = position(a);
    const [bt, bk] = position(b);
    return bt - at || (ak < bk ? 1 : ak > bk ? -1 : 0);
  });
  const remaining = after
    ? sorted.filter((item) => {
        const [time, key] = position(item);
        return time < after[0] || (time === after[0] && key < after[1]);
      })
    : sorted;
  const page = remaining.slice(0, limit);
  return {
    items: page,
    nextCursor:
      remaining.length > limit
        ? socialCursor(position(page[page.length - 1]))
        : null,
  };
}

export class ReviewSocialStorage extends ReviewReplyStorage {
  async getSocialNotifications(
    ...args: Parameters<IStorage['getSocialNotifications']>
  ) {
    return new SocialNotificationStorage(this.sql).getSocialNotifications(
      ...args,
    );
  }
  async getSocialNotificationCount(
    ...args: Parameters<IStorage['getSocialNotificationCount']>
  ) {
    return new SocialNotificationStorage(this.sql).getSocialNotificationCount(
      ...args,
    );
  }
  async getPublicReview(
    ...[target, viewer]: Parameters<IStorage['getPublicReview']>
  ): ReturnType<IStorage['getPublicReview']> {
    const rows = await this.sql.rows<VideoReviewRow>(
      'SELECT v.username, v.review_json FROM video_reviews v JOIN user_profiles p ON p.username = v.username WHERE p.profile_id = ? AND v.title_norm = ? AND v.year = ? AND v.is_public = 1',
      [target.profileId, target.title_norm, target.year],
    );
    return rows.length
      ? publicReview((await this.enrichReviews(rows, viewer))[0])
      : null;
  }

  async getUserProfile(username: string): Promise<UserProfile | null> {
    const rows = await this.sql.rows<UserProfile>(
      'SELECT * FROM user_profiles WHERE username = ?',
      [normalizeUsername(username)],
    );
    return rows[0] ? profileFromRow(rows[0]) : null;
  }
  async getUserProfileById(id: string): Promise<UserProfile | null> {
    const rows = await this.sql.rows<UserProfile>(
      'SELECT * FROM user_profiles WHERE profile_id = ?',
      [id],
    );
    return rows[0] ? profileFromRow(rows[0]) : null;
  }
  async ensureUserProfile(username: string): Promise<UserProfile> {
    username = normalizeUsername(username);
    for (let attempt = 0; attempt < 8; attempt++) {
      const existing = await this.getUserProfile(username);
      if (existing) return existing;
      const id = newProfileId();
      const insert =
        this.sql.dialect === 'sqlite' ? 'INSERT OR IGNORE' : 'INSERT IGNORE';
      await this.sql.run(
        `${insert} INTO user_profiles (username, profile_id, nickname, nickname_norm, avatar_seed, favorites_public, updated_at) VALUES (?, ?, NULL, NULL, NULL, 0, ?)`,
        [username, id, Date.now()],
      );
    }
    throw new Error('无法分配用户资料标识');
  }
  async isNicknameAvailable(
    nickname: string,
    exceptUsername = '',
  ): Promise<boolean> {
    const { nicknameNorm } = validateNickname(nickname, {
      allowReserved: true,
    });
    const rows = await this.sql.rows(
      'SELECT username FROM user_profiles WHERE nickname_norm = ? AND username <> ?',
      [nicknameNorm, normalizeUsername(exceptUsername)],
    );
    return rows.length === 0;
  }
  async updateUserProfile(
    username: string,
    patch: {
      nickname?: string;
      avatarSeed?: string | null;
      libraryVisibility?: LibraryVisibility;
    },
  ): Promise<UserProfile> {
    username = normalizeUsername(username);
    await this.ensureUserProfile(username);
    const columns: string[] = [];
    const params: unknown[] = [];
    if (patch.nickname !== undefined) {
      const validated = validateNickname(patch.nickname, {
        allowReserved: true,
      });
      columns.push('nickname = ?', 'nickname_norm = ?');
      params.push(validated.nickname, validated.nicknameNorm);
    }
    if (patch.avatarSeed !== undefined) {
      columns.push('avatar_seed = ?');
      params.push(validateAvatarSeed(patch.avatarSeed));
    }
    if (patch.libraryVisibility !== undefined) {
      columns.push('favorites_public = ?');
      params.push(validateLibraryVisibility(patch.libraryVisibility));
    }
    if (columns.length) {
      try {
        await this.sql.run(
          `UPDATE user_profiles SET ${columns.join(', ')}, updated_at = ? WHERE username = ?`,
          [...params, Date.now(), username],
        );
      } catch (error) {
        if (isUniqueError(error)) throw new NicknameTakenError();
        throw error;
      }
    }
    return (await this.getUserProfile(username))!;
  }
  async getAnnualRecap(
    ...args: Parameters<IStorage['getAnnualRecap']>
  ): ReturnType<IStorage['getAnnualRecap']> {
    return new AnnualRecapStorage(this.sql).getAnnualRecap(...args);
  }
  async getAnnualRecapYears(
    ...args: Parameters<IStorage['getAnnualRecapYears']>
  ): ReturnType<IStorage['getAnnualRecapYears']> {
    return new AnnualRecapStorage(this.sql).getAnnualRecapYears(...args);
  }
  async saveAnnualRecap(
    ...args: Parameters<IStorage['saveAnnualRecap']>
  ): ReturnType<IStorage['saveAnnualRecap']> {
    return new AnnualRecapStorage(this.sql).saveAnnualRecap(...args);
  }
  async deleteAnnualRecap(
    ...args: Parameters<IStorage['deleteAnnualRecap']>
  ): ReturnType<IStorage['deleteAnnualRecap']> {
    return new AnnualRecapStorage(this.sql).deleteAnnualRecap(...args);
  }
  async getFollowRecapMessages(
    ...args: Parameters<IStorage['getFollowRecapMessages']>
  ): ReturnType<IStorage['getFollowRecapMessages']> {
    return new AnnualRecapStorage(this.sql).getFollowRecapMessages(...args);
  }
  async getFollowRecapMessageCount(
    ...args: Parameters<IStorage['getFollowRecapMessageCount']>
  ): ReturnType<IStorage['getFollowRecapMessageCount']> {
    return new AnnualRecapStorage(this.sql).getFollowRecapMessageCount(...args);
  }
  async getUserProfileView(
    username: string,
    viewer: string,
  ): Promise<UserProfileView | null> {
    username = normalizeUsername(username);
    viewer = normalizeUsername(viewer);
    const profile = await this.getUserProfile(username);
    if (!profile) return null;
    const isSelf = username === viewer;
    // 收藏不公开时不统计收藏数，避免经由数量泄露
    const favoritesVisible = isSelf || profile.favorites_public > 0;
    const [counts] = await this.sql.rows<{
      followers: number;
      following: number;
      reviews: number;
      lists: number;
      followed: number;
      favorites: number;
    }>(
      `SELECT
      (SELECT COUNT(*) FROM user_lists WHERE username = ?${isSelf ? '' : ' AND is_public >= 1'}) AS lists,
      (SELECT COUNT(*) FROM user_follows WHERE followee = ?) AS followers,
      (SELECT COUNT(*) FROM user_follows WHERE follower = ?) AS following,
      (SELECT COUNT(*) FROM video_reviews WHERE username = ? AND is_public = 1) AS reviews,
      (SELECT COUNT(*) FROM user_follows WHERE follower = ? AND followee = ?) AS followed,
      ${favoritesVisible ? `(SELECT COUNT(*) FROM favorites WHERE username = ? AND library_valid = 1 AND ${profileFavoriteOriginSql(this.sql.dialect)})` : '0'} AS favorites`,
      [
        username,
        username,
        username,
        username,
        viewer,
        username,
        ...(favoritesVisible ? [username] : []),
      ],
    );
    const year = (await this.getAnnualRecapYears(username))[0];
    return {
      recap: year ? { year } : null,
      profileId: profile.profile_id,
      nickname: profile.nickname,
      avatarSeed: profile.avatar_seed,
      libraryVisibility: profile.favorites_public,
      isSelf,
      isFollowing: Number(counts.followed) > 0,
      followerCount: Number(counts.followers),
      followingCount: Number(counts.following),
      publicReviewCount: Number(counts.reviews),
      listCount: Number(counts.lists),
      favoriteCount: Number(counts.favorites),
    };
  }
  async setUserFollow(
    follower: string,
    followee: string,
    following: boolean,
  ): Promise<{ following: boolean; followerCount: number }> {
    follower = normalizeUsername(follower);
    followee = normalizeUsername(followee);
    if (follower === followee) throw new ReviewValidationError('不能关注自己');
    if (following) {
      const insert =
        this.sql.dialect === 'sqlite' ? 'INSERT OR IGNORE' : 'INSERT IGNORE';
      await this.sql.run(
        `${insert} INTO user_follows (follower, followee, created_at) SELECT ?, username, ? FROM user_profiles WHERE username = ?`,
        [follower, Date.now(), followee],
      );
    } else
      await this.sql.run(
        'DELETE FROM user_follows WHERE follower = ? AND followee = ?',
        [follower, followee],
      );
    const [row] = await this.sql.rows<{ count: number }>(
      'SELECT COUNT(*) AS count FROM user_follows WHERE followee = ?',
      [followee],
    );
    return { following, followerCount: Number(row.count) };
  }
  async getUserFollowPage(
    username: string,
    type: 'followers' | 'following',
    cursor?: string,
  ): Promise<FollowListPage> {
    const pageSize = 30;
    const after = parseSocialCursor(cursor);
    const column = type === 'followers' ? 'followee' : 'follower';
    const target = type === 'followers' ? 'follower' : 'followee';
    const rows = await this.sql.rows<{
      profile_id: string;
      nickname: string | null;
      avatar_seed: string | null;
      created_at: number;
    }>(
      `SELECT p.profile_id, p.nickname, p.avatar_seed, f.created_at
       FROM user_follows f JOIN user_profiles p ON p.username = f.${target}
       WHERE f.${column} = ?
       ${after ? 'AND (f.created_at < ? OR (f.created_at = ? AND p.profile_id < ?))' : ''}
       ORDER BY f.created_at DESC, p.profile_id DESC LIMIT ?`,
      [
        normalizeUsername(username),
        ...(after ? [after[0], after[0], after[1]] : []),
        pageSize + 1,
      ],
    );
    return socialPage(
      rows.map((row) => ({
        profileId: row.profile_id,
        nickname: row.nickname,
        avatarSeed: row.avatar_seed,
        followedAt: Number(row.created_at),
      })),
      pageSize,
      undefined,
      (row) => [row.followedAt, row.profileId],
    );
  }
  async enrichReviews(
    rows: VideoReviewRow[],
    viewer = '',
  ): Promise<VideoReviewRow[]> {
    if (!rows.length) return [];
    const usernames = [
      ...new Set(rows.map((row) => normalizeUsername(row.username))),
    ];
    const access = await this.sql.rows<{ username: string; role: string }>(
      `SELECT username, role FROM user_access WHERE username IN (${usernames.map(() => '?').join(',')})`,
      usernames,
    );
    const roles = new Map(access.map((user) => [user.username, user.role]));
    const follows = viewer
      ? await this.sql.rows<{ followee: string }>(
          `SELECT followee FROM user_follows WHERE follower = ? AND followee IN (${usernames.map(() => '?').join(',')})`,
          [normalizeUsername(viewer), ...usernames],
        )
      : [];
    const followedAuthors = new Set(follows.map((row) => row.followee));
    return Promise.all(
      rows.map(async (row) => {
        const review = JSON.parse(row.review_json) as VideoReview;
        const profile = await this.ensureUserProfile(row.username);
        const [likes] = await this.sql.rows<{ count: number; liked: number }>(
          'SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN liker = ? THEN 1 ELSE 0 END), 0) AS liked FROM video_review_likes WHERE author = ? AND title_norm = ? AND year = ?',
          [
            normalizeUsername(viewer),
            row.username,
            review.title_norm,
            review.year,
          ],
        );
        const [replies] = await this.sql.rows<{ count: number }>(
          'SELECT COUNT(*) AS count FROM video_review_replies WHERE author = ? AND title_norm = ? AND year = ?',
          [row.username, review.title_norm, review.year],
        );
        return {
          ...row,
          role: publicUserRole(
            row.username,
            roles.get(normalizeUsername(row.username)),
          ),
          author_followed: followedAuthors.has(normalizeUsername(row.username)),
          reply_count: Number(replies.count),
          profile_id: profile.profile_id,
          nickname: profile.nickname,
          avatar_seed: profile.avatar_seed,
          like_count: Number(likes.count),
          liked_by_me: Number(likes.liked) > 0,
        };
      }),
    );
  }
  async getMyVideoReviewCount(username: string): Promise<number> {
    const [row] = await this.sql.rows<{ count: number }>(
      'SELECT COUNT(*) AS count FROM video_reviews WHERE username = ?',
      [normalizeUsername(username)],
    );
    return Number(row.count);
  }

  async getMyVideoReviewRatings(
    username: string,
  ): Promise<VideoReviewRating[]> {
    const { rating } = reviewSql(this.sql.dialect);
    const rows = await this.sql.rows<VideoReviewRating>(
      `SELECT title_norm, year, ${rating} AS rating FROM video_reviews WHERE username = ?`,
      [normalizeUsername(username)],
    );
    return rows.map((row) => ({
      ...row,
      rating: row.rating === null ? null : Number(row.rating),
    }));
  }

  async getMyVideoReviewPage(
    username: string,
    query: MyReviewQuery = {},
  ): Promise<MyVideoReviewPage> {
    const { q, filter, sort, after } = validateMyReviewQuery(query);
    const { rating, title } = reviewSql(this.sql.dialect);
    const content =
      this.sql.dialect === 'sqlite'
        ? "json_extract(review_json, '$.content')"
        : "JSON_UNQUOTE(JSON_EXTRACT(review_json, '$.content'))";
    const haystack =
      this.sql.dialect === 'sqlite'
        ? `${title} || ' ' || ${content}`
        : `CONCAT(${title}, ' ', ${content})`;
    const where = `username = ? AND (? = '' OR LOWER(${haystack}) LIKE LOWER(?) ESCAPE '!')`;
    const params = [
      normalizeUsername(username),
      q,
      `%${q.replace(/[!%_]/g, '!$&')}%`,
    ];
    const [counts] = await this.sql.rows<{
      all: number;
      public: number;
      private: number;
      text: number;
    }>(
      `SELECT COUNT(*) AS \`all\`, COALESCE(SUM(is_public), 0) AS \`public\`, COALESCE(SUM(1-is_public), 0) AS \`private\`, COALESCE(SUM(CASE WHEN ${rating} IS NULL THEN 1 ELSE 0 END), 0) AS \`text\` FROM video_reviews WHERE ${where}`,
      params,
    );
    // 整数排名统一降序；无评分在高低分两种排序下都沉底。
    const rank =
      sort === 'updated'
        ? 'updated_at'
        : `COALESCE(${sort === 'high' ? `ROUND(${rating} * 10)` : `101 - ROUND(${rating} * 10)`}, 0)`;
    const filtered =
      filter === 'public'
        ? ' AND is_public = 1'
        : filter === 'private'
          ? ' AND is_public = 0'
          : filter === 'text'
            ? ` AND ${rating} IS NULL`
            : '';
    const rows = await this.sql.rows<VideoReviewRow>(
      `SELECT review_json FROM video_reviews WHERE ${where}${filtered}
       ${after ? `AND (${rank} < ? OR (${rank} = ? AND (updated_at < ? OR (updated_at = ? AND (title_norm < ? OR (title_norm = ? AND year < ?))))))` : ''}
       ORDER BY ${rank} DESC, updated_at DESC, title_norm DESC, year DESC LIMIT ${MY_REVIEWS_PAGE_SIZE + 1}`,
      [
        ...params,
        ...(after
          ? [
              after[0],
              after[0],
              Number(after[1]),
              Number(after[1]),
              after[2],
              after[2],
              after[3],
            ]
          : []),
      ],
    );
    const items = rows
      .slice(0, MY_REVIEWS_PAGE_SIZE)
      .map((row) => JSON.parse(row.review_json) as VideoReview);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > MY_REVIEWS_PAGE_SIZE && last
          ? socialCursor([
              sort === 'updated'
                ? last.updated_at
                : last.rating === null
                  ? 0
                  : sort === 'high'
                    ? Math.round(last.rating * 10)
                    : 101 - Math.round(last.rating * 10),
              String(last.updated_at),
              last.title_norm,
              last.year,
            ])
          : null,
      total: await this.getMyVideoReviewCount(username),
      counts: {
        all: Number(counts.all),
        public: Number(counts.public),
        private: Number(counts.private),
        text: Number(counts.text),
      },
    };
  }

  async getWorkWatchStatuses(
    viewer: string,
    works: { title: string; year: string }[],
  ): ReturnType<IStorage['getWorkWatchStatuses']> {
    if (!works.length) return [];
    const result: Awaited<ReturnType<IStorage['getWorkWatchStatuses']>> = [];
    // 避免 SQLite 参数数量限制；每批仅执行一次作品匹配查询。
    for (let offset = 0; offset < works.length; offset += 200) {
      const batch = works.slice(offset, offset + 200);
      const rows = await this.sql.rows<{ status: (typeof result)[number] }>(
        `SELECT (${workStatusSelection(this.sql.dialect, '?', 'w.title_norm', 'w.year')}) AS status
         FROM (${batch.map((_, index) => `SELECT ${index} AS position, ? AS title_norm, ? AS year`).join(' UNION ALL ')}) w ORDER BY w.position`,
        [
          normalizeUsername(viewer),
          ...batch.flatMap((work) => [
            normalizeWorkTitle(work.title),
            normalizeWorkYear(work.year),
          ]),
        ],
      );
      result.push(...rows.map((row) => row.status));
    }
    return result;
  }

  async getFollowOpinions(
    viewer: string,
    titleNorm: string,
    year: string,
  ): ReturnType<IStorage['getFollowOpinions']> {
    type OpinionRow = UserProfile & {
      status: import('@/lib/types').FavoriteWatchStatus | null;
      review_json: string | null;
      recent: number;
    };
    const rows = await this.sql.rows<OpinionRow>(
      `SELECT profile.*, CASE WHEN profile.favorites_public >= 2 THEN (${workStatusSelection(this.sql.dialect, 'profile.username', '?', '?', true)}) ELSE NULL END AS status,
       (SELECT CASE WHEN r.is_public = 1 THEN r.review_json ELSE NULL END FROM video_reviews r WHERE r.username = profile.username AND r.title_norm = ? AND (? = '' OR r.year IN (?, '')) ORDER BY CASE WHEN r.year = ? THEN 0 ELSE 1 END, r.updated_at DESC, r.year DESC LIMIT 1) AS review_json,
       (${workStatusSelection(this.sql.dialect, 'profile.username', '?', '?', true, 'recent')}) AS recent
       FROM user_follows follow JOIN user_profiles profile ON profile.username = follow.followee WHERE follow.follower = ?`,
      [
        titleNorm,
        year,
        year,
        titleNorm,
        year,
        year,
        year,
        titleNorm,
        year,
        year,
        normalizeUsername(viewer),
      ],
    );
    const order = { completed: 0, watching: 1, planned: 2 };
    const items = rows
      .map((row) => {
        const review = row.review_json
          ? (JSON.parse(row.review_json) as VideoReview)
          : null;
        return {
          author: {
            profileId: row.profile_id,
            nickname: row.nickname,
            avatarSeed: row.avatar_seed,
          },
          status: row.status,
          rating: review?.rating ?? null,
          hasPublicReview: review !== null,
          recent: Math.max(
            row.status ? Number(row.recent ?? 0) : 0,
            review?.updated_at ?? 0,
          ),
        };
      })
      .filter((item) => item.status !== null || item.hasPublicReview)
      .sort(
        (a, b) =>
          (a.status ? order[a.status] : 3) - (b.status ? order[b.status] : 3) ||
          b.recent - a.recent ||
          b.author.profileId.localeCompare(a.author.profileId),
      )
      .map(({ recent: _recent, ...item }) => item);
    const rated = items.filter((item) => item.rating !== null);
    return {
      items,
      watchedCount: items.filter((item) => item.status === 'completed').length,
      ratedCount: rated.length,
      averageRating: rated.length
        ? rated.reduce((sum, item) => sum + item.rating!, 0) / rated.length
        : null,
    };
  }

  async getTasteMatch(
    viewer: string,
    username: string,
  ): ReturnType<IStorage['getTasteMatch']> {
    viewer = normalizeUsername(viewer);
    username = normalizeUsername(username);
    const rating = (alias: string) =>
      reviewSql(this.sql.dialect).rating.replaceAll(
        'review_json',
        `${alias}.review_json`,
      );
    // 每条对方评价只匹配本人一条：精确年份优先，其次未知年份，再按更新时间。
    const ownYear = `COALESCE((SELECT exact.year FROM video_reviews exact WHERE exact.username = own.username AND exact.title_norm = peer.title_norm AND exact.year = peer.year), (SELECT mine.year FROM video_reviews mine WHERE mine.username = own.username AND mine.title_norm = peer.title_norm AND (mine.year = '' OR peer.year = '') ORDER BY mine.updated_at DESC, mine.year DESC LIMIT 1))`;
    const [common] = await this.sql.rows<{
      count: number;
      difference: number | null;
    }>(
      `SELECT COUNT(*) AS count, SUM(ABS(${rating('peer')} - ${rating('own')})) AS difference
       FROM video_reviews peer JOIN video_reviews own ON own.username = ? AND own.title_norm = peer.title_norm AND own.year = (${ownYear})
       WHERE peer.username = ? AND peer.is_public = 1 AND ${rating('peer')} IS NOT NULL AND ${rating('own')} IS NOT NULL`,
      [viewer, username],
    );
    const rows = await this.sql.rows<VideoReviewRow>(
      `SELECT peer.username, peer.review_json FROM video_reviews peer
       WHERE peer.username = ? AND peer.is_public = 1 AND ${rating('peer')} >= 8
       AND NOT EXISTS (SELECT 1 FROM video_reviews mine WHERE mine.username = ? AND mine.title_norm = peer.title_norm AND (mine.year = peer.year OR mine.year = '' OR peer.year = ''))
       AND COALESCE((${workStatusSelection(this.sql.dialect, '?', 'peer.title_norm', 'peer.year')}), 'planned') NOT IN ('watching', 'completed')
       ORDER BY ${rating('peer')} DESC, peer.updated_at DESC, peer.title_norm DESC, peer.year DESC LIMIT 12`,
      [username, viewer, viewer],
    );
    return {
      commonCount: Number(common.count),
      score: tasteMatchScore(
        Number(common.count),
        Number(common.difference ?? 0),
      ),
      picks: (await this.enrichReviews(rows, viewer)).map(publicReview),
    };
  }

  async getWorkVideoReviewPage(
    titleNorm: string,
    year: string,
    viewer: string,
    cursor?: string,
  ): Promise<WorkReviewSummary> {
    viewer = normalizeUsername(viewer);
    const binding = createHash('sha256').update(viewer).digest('hex');
    const after = decodeWorkReviewCursor(cursor, binding, titleNorm, year);
    const queries = reviewSql(this.sql.dialect);
    const params = [titleNorm, year, year];
    const followed = 'CASE WHEN follow.followee IS NULL THEN 0 ELSE 1 END';
    const rows = await this.sql.rows<VideoReviewRow>(
      `SELECT r.username, r.review_json, p.profile_id FROM video_reviews r JOIN user_profiles p ON p.username = r.username
       LEFT JOIN user_follows follow ON follow.followee = r.username AND follow.follower = ?
       WHERE r.title_norm = ? AND r.is_public = 1 AND (? = '' OR r.year IN (?, ''))
       ${after ? `AND (${followed} < ? OR (${followed} = ? AND (r.updated_at < ? OR (r.updated_at = ? AND (p.profile_id < ? OR (p.profile_id = ? AND r.year < ?))))))` : ''}
       ORDER BY ${followed} DESC, r.updated_at DESC, p.profile_id DESC, r.year DESC LIMIT ${WORK_REVIEWS_PAGE_SIZE + 1}`,
      [
        viewer,
        ...params,
        ...(after
          ? [
              after.followed,
              after.followed,
              after.time,
              after.time,
              after.profileId,
              after.profileId,
              after.year,
            ]
          : []),
      ],
    );
    const [summary] = await this.sql.rows<{
      average: number | null;
      count: number;
    }>(queries.summary, params);
    const [total] = await this.sql.rows<{ count: number }>(
      "SELECT COUNT(*) AS count FROM video_reviews WHERE title_norm = ? AND is_public = 1 AND (? = '' OR year IN (?, ''))",
      params,
    );
    const buckets = await this.sql.rows<{ bucket: number; count: number }>(
      queries.distribution,
      params,
    );
    const distribution = Array<number>(10).fill(0);
    for (const row of buckets)
      distribution[Math.min(9, Math.max(0, Number(row.bucket) - 1))] += Number(
        row.count,
      );
    const items = rows.slice(0, WORK_REVIEWS_PAGE_SIZE);
    const reviews = (await this.enrichReviews(items, viewer)).map(publicReview);
    const last = reviews.at(-1);
    return {
      reviews,
      average: summary.average === null ? null : Number(summary.average),
      count: Number(summary.count),
      reviewCount: Number(total.count),
      distribution,
      nextCursor:
        rows.length > WORK_REVIEWS_PAGE_SIZE && last
          ? socialCursor([
              'work-v2',
              binding,
              titleNorm,
              year,
              Number(last.authorFollowed),
              last.updated_at,
              last.author.profileId,
              last.year,
            ])
          : null,
    };
  }

  async getUserPublicReviewPage(
    username: string,
    viewer: string,
    cursor?: string,
  ): Promise<PublicVideoReviewPage> {
    const after = parseSocialCursor(cursor);
    let identity: [string, string] | null = null;
    if (after) {
      try {
        const value = JSON.parse(after[1]);
        if (
          !Array.isArray(value) ||
          value.length !== 2 ||
          typeof value[0] !== 'string' ||
          !value[0] ||
          value[0].length > 191 ||
          typeof value[1] !== 'string' ||
          value[1].length > 16
        )
          throw new Error();
        identity = value as [string, string];
      } catch {
        throw new ReviewValidationError('分页游标无效');
      }
    }
    const rows = await this.sql.rows<VideoReviewRow>(
      `SELECT username, review_json FROM video_reviews WHERE username = ? AND is_public = 1
       ${after ? 'AND (updated_at < ? OR (updated_at = ? AND (title_norm < ? OR (title_norm = ? AND year < ?))))' : ''}
       ORDER BY updated_at DESC, title_norm DESC, year DESC LIMIT ${MY_REVIEWS_PAGE_SIZE + 1}`,
      [
        normalizeUsername(username),
        ...(after && identity
          ? [after[0], after[0], identity[0], identity[0], identity[1]]
          : []),
      ],
    );
    const items = (
      await this.enrichReviews(rows.slice(0, MY_REVIEWS_PAGE_SIZE), viewer)
    ).map(publicReview);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > MY_REVIEWS_PAGE_SIZE && last
          ? socialCursor([
              last.updated_at,
              JSON.stringify([last.title_norm, last.year]),
            ])
          : null,
    };
  }
  async setVideoReviewLike(
    author: string,
    title: string,
    year: string,
    liker: string,
    liked: boolean,
  ): Promise<{ liked: boolean; likeCount: number } | null> {
    author = normalizeUsername(author);
    liker = normalizeUsername(liker);
    if (author === liker) throw new ReviewValidationError('不能给自己点赞');
    const target = [author, title, year];
    const rows = await this.sql.rows(
      'SELECT username FROM video_reviews WHERE username = ? AND title_norm = ? AND year = ? AND is_public = 1',
      target,
    );
    if (!rows.length) return null;
    if (liked) {
      const insert =
        this.sql.dialect === 'sqlite' ? 'INSERT OR IGNORE' : 'INSERT IGNORE';
      await this.sql.run(
        `${insert} INTO video_review_likes (author, title_norm, year, liker, created_at) SELECT username, title_norm, year, ?, ? FROM video_reviews WHERE username = ? AND title_norm = ? AND year = ? AND is_public = 1`,
        [liker, Date.now(), ...target],
      );
    } else
      await this.sql.run(
        'DELETE FROM video_review_likes WHERE author = ? AND title_norm = ? AND year = ? AND liker = ?',
        [...target, liker],
      );
    const [count] = await this.sql.rows<{ count: number }>(
      'SELECT COUNT(*) AS count FROM video_review_likes WHERE author = ? AND title_norm = ? AND year = ?',
      target,
    );
    return { liked, likeCount: Number(count.count) };
  }
  async reportVideoReview(
    author: string,
    title: string,
    year: string,
    reporter: string,
    reason: ReviewReportReason,
    detail: string,
  ): Promise<boolean> {
    author = normalizeUsername(author);
    reporter = normalizeUsername(reporter);
    if (author === reporter) throw new ReviewValidationError('不能举报自己');
    const conflict =
      this.sql.dialect === 'sqlite'
        ? 'ON CONFLICT(author, title_norm, year, reporter) DO UPDATE SET reason = excluded.reason, detail = excluded.detail, created_at = excluded.created_at'
        : 'ON DUPLICATE KEY UPDATE reason = VALUES(reason), detail = VALUES(detail), created_at = VALUES(created_at)';
    return (
      (await this.sql.run(
        `INSERT INTO video_review_reports (author, title_norm, year, reporter, reason, detail, created_at) SELECT username, title_norm, year, ?, ?, ?, ? FROM video_reviews WHERE username = ? AND title_norm = ? AND year = ? AND is_public = 1 ${conflict}`,
        [reporter, reason, detail, Date.now(), author, title, year],
      )) > 0
    );
  }
  async getReviewReportPage(cursor?: string): Promise<AdminReviewReportPage> {
    const after = parseSocialCursor(cursor);
    let identity: string[] = [];
    if (after) {
      try {
        const value = JSON.parse(after[1]);
        if (
          !Array.isArray(value) ||
          value.length !== 6 ||
          value[0] !== 'reports-v3' ||
          value.slice(1).some((part: unknown) => typeof part !== 'string')
        )
          throw new Error();
        identity = value.slice(1);
      } catch {
        throw new ReviewValidationError('举报分页已更新，请刷新列表');
      }
    }
    const reasons = REVIEW_REPORT_REASONS.map(
      (reason) =>
        `SUM(CASE WHEN r.reason = '${reason}' THEN 1 ELSE 0 END) AS ${reason}`,
    ).join(', ');
    const grouped = `SELECT 'review' AS kind, '' AS reply_id, r.author, r.title_norm, r.year, COUNT(*) AS report_count, MAX(r.created_at) AS latest_reported_at, ${reasons}
      FROM video_review_reports r JOIN video_reviews v ON v.username = r.author AND v.title_norm = r.title_norm AND v.year = r.year WHERE v.is_public = 1 GROUP BY r.author, r.title_norm, r.year
      UNION ALL
      SELECT 'reply' AS kind, q.id AS reply_id, q.author, q.title_norm, q.year, COUNT(*) AS report_count, MAX(r.created_at) AS latest_reported_at, ${reasons}
      FROM video_review_reply_reports r JOIN video_review_replies q ON q.id = r.reply_id JOIN video_reviews v ON v.username = q.author AND v.title_norm = q.title_norm AND v.year = q.year WHERE v.is_public = 1 GROUP BY q.id, q.author, q.title_norm, q.year`;
    const [total] = await this.sql.rows<{ count: number }>(
      `SELECT COUNT(*) AS count FROM (${grouped}) pending`,
    );
    type GroupRow = VideoReviewRow & {
      kind: string;
      reply_id: string;
      author: string;
      title_norm: string;
      year: string;
      report_count: number;
      latest_reported_at: number;
    } & Record<ReviewReportReason, number>;
    const groups = await this.sql.rows<GroupRow>(
      `SELECT g.*, v.username, v.review_json, p.profile_id, p.nickname, p.avatar_seed
      FROM (${grouped}) g JOIN video_reviews v ON v.username = g.author AND v.title_norm = g.title_norm AND v.year = g.year JOIN user_profiles p ON p.username = g.author
      WHERE v.is_public = 1 ${after ? 'AND (g.latest_reported_at < ? OR (g.latest_reported_at = ? AND (g.kind, g.author, g.title_norm, g.year, g.reply_id) < (?, ?, ?, ?, ?)))' : ''}
      ORDER BY g.latest_reported_at DESC, g.kind DESC, g.author DESC, g.title_norm DESC, g.year DESC, g.reply_id DESC LIMIT 31`,
      after ? [after[0], after[0], ...identity] : [],
    );
    const items: AdminReviewReportPage['items'] = [];
    const reviews = await this.enrichReviews(groups.slice(0, 30));
    for (const [index, row] of groups.slice(0, 30).entries()) {
      const reply =
        row.kind === 'reply'
          ? await this.getPublicReplyById(row.reply_id, '')
          : null;
      const reports = await this.sql.rows<{
        profile_id: string;
        nickname: string | null;
        avatar_seed: string | null;
        reason: ReviewReportReason;
        detail: string;
        created_at: number;
      }>(
        `SELECT r.*, p.profile_id, p.nickname, p.avatar_seed FROM ${row.kind === 'reply' ? 'video_review_reply_reports' : 'video_review_reports'} r JOIN user_profiles p ON p.username = r.reporter WHERE ${row.kind === 'reply' ? 'r.reply_id = ?' : 'r.author = ? AND r.title_norm = ? AND r.year = ?'} ORDER BY r.created_at DESC, r.reporter DESC LIMIT 5`,
        row.kind === 'reply'
          ? [row.reply_id]
          : [row.author, row.title_norm, row.year],
      );
      items.push({
        review: { ...publicReview(reviews[index]), username: row.username },
        ...(reply ? { reply } : {}),
        reportCount: Number(row.report_count),
        reasons: Object.fromEntries(
          REVIEW_REPORT_REASONS.filter((reason) => Number(row[reason]) > 0).map(
            (reason) => [reason, Number(row[reason])],
          ),
        ),
        latestReportedAt: Number(row.latest_reported_at),
        reports: reports.map((report) => ({
          reporter: {
            profileId: report.profile_id,
            nickname: report.nickname,
            avatarSeed: report.avatar_seed,
          },
          reason: report.reason,
          detail: report.detail,
          created_at: Number(report.created_at),
        })),
      });
    }
    const last = groups.slice(0, 30).at(-1);
    return {
      items,
      pendingTotal: Number(total.count),
      nextCursor:
        groups.length > 30 && last
          ? socialCursor([
              Number(last.latest_reported_at),
              JSON.stringify([
                'reports-v3',
                last.kind,
                last.author,
                last.title_norm,
                last.year,
                last.reply_id,
              ]),
            ])
          : null,
    };
  }
  private followReviewWhere(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
  ) {
    const ids = readIds
      .map(parseFollowReviewMessageId)
      .filter((id) => id !== null);
    return {
      from: `FROM user_follows f JOIN video_reviews v ON v.username = f.followee JOIN user_profiles p ON p.username = v.username
        WHERE f.follower = ? AND v.is_public = 1 AND v.first_published_at > f.created_at AND v.first_published_at > ?
        ${ids.map(() => 'AND NOT (p.profile_id = ? AND v.title_norm = ? AND v.year = ? AND v.first_published_at = ?)').join(' ')}`,
      params: [
        normalizeUsername(username),
        Math.max(readAt, now - 30 * 86400000),
        ...ids.flat(),
      ],
    };
  }

  async getFollowReviewMessageCount(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
  ): Promise<number> {
    const { from, params } = this.followReviewWhere(
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

  async getFollowReviewMessages(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
    query: FollowReviewQuery = {},
  ): Promise<FollowReviewUserMessage[]> {
    const { from, params } = this.followReviewWhere(
      username,
      readAt,
      readIds,
      now,
    );
    let filter = '';
    if (query.id) {
      const identity = parseFollowReviewMessageId(query.id);
      if (!identity) return [];
      filter +=
        ' AND p.profile_id = ? AND v.title_norm = ? AND v.year = ? AND v.first_published_at = ?';
      params.push(...identity);
    }
    if (query.before) {
      const { createdAt, key } = query.before;
      const identity = parseFollowReviewSortKey(key);
      if (identity) {
        filter +=
          ' AND (v.first_published_at < ? OR (v.first_published_at = ? AND (p.profile_id, v.title_norm, v.year) < (?, ?, ?)))';
        params.push(createdAt, createdAt, ...identity);
      } else {
        filter +=
          key > 'follow-review:'
            ? ' AND v.first_published_at <= ?'
            : ' AND v.first_published_at < ?';
        params.push(createdAt);
      }
    }
    const limit = Math.max(1, Math.min(201, Math.floor(query.limit ?? 30)));
    const rows = await this.sql.rows<
      VideoReviewRow & {
        profile_id: string;
        nickname: string | null;
        first_published_at: number;
      }
    >(
      `SELECT v.username, v.review_json, v.first_published_at, p.profile_id, p.nickname, p.avatar_seed ${from}${filter}
       ORDER BY v.first_published_at DESC, p.profile_id DESC, v.title_norm DESC, v.year DESC LIMIT ?`,
      [...params, limit],
    );
    return rows.map((row) => {
      const r = JSON.parse(row.review_json) as VideoReview;
      return {
        id: followReviewMessageId(
          row.profile_id,
          r.title_norm,
          r.year,
          Number(row.first_published_at),
        ),
        type: 'follow-review' as const,
        review: {
          profileId: row.profile_id,
          title_norm: r.title_norm,
          year: r.year,
        },
        author: {
          profileId: row.profile_id,
          nickname: row.nickname,
          avatarSeed: row.avatar_seed ?? null,
        },
        title: r.title,
        year: r.year,
        cover: r.cover,
        rating: r.rating,
        createdAt: Number(row.first_published_at),
      };
    });
  }
  async getUserSocialData(username: string): Promise<UserSocialData> {
    username = normalizeUsername(username);
    const profile = await this.getUserProfile(username);
    const follows = await this.sql.rows<
      NonNullable<UserSocialData['follows']>[number]
    >('SELECT followee, created_at FROM user_follows WHERE follower = ?', [
      username,
    ]);
    const likes = await this.sql.rows<
      NonNullable<UserSocialData['likes']>[number]
    >(
      'SELECT author, title_norm, year, created_at FROM video_review_likes WHERE liker = ?',
      [username],
    );
    const reports = await this.sql.rows<
      NonNullable<UserSocialData['reports']>[number]
    >(
      'SELECT author, title_norm, year, reason, detail, created_at FROM video_review_reports WHERE reporter = ?',
      [username],
    );
    const replies = await this.sql.rows<
      NonNullable<UserSocialData['replies']>[number]
    >(
      'SELECT id, author, title_norm, year, reply_to, content, created_at FROM video_review_replies WHERE username = ?',
      [username],
    );
    const replyReports = await this.sql.rows<
      NonNullable<UserSocialData['replyReports']>[number]
    >(
      'SELECT reply_id, reason, detail, created_at FROM video_review_reply_reports WHERE reporter = ?',
      [username],
    );
    return {
      profile: profile ?? undefined,
      follows,
      likes,
      reports,
      replies,
      replyReports,
    };
  }
}

export function isUniqueError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    [
      'SQLITE_CONSTRAINT_UNIQUE',
      'SQLITE_CONSTRAINT_PRIMARYKEY',
      'ER_DUP_ENTRY',
    ].includes(String(error.code))
  );
}
