import { randomInt } from 'crypto';

import type { FollowReviewUserMessage } from '@/lib/message-types';
import type {
  AdminReviewReportPage,
  FollowListPage,
  PublicVideoReviewPage,
  ReviewReportReason,
  StorageUserImportData,
  UserProfile,
  UserProfileView,
  VideoReview,
} from '@/lib/types';
import { validateAvatarSeed, validateNickname } from '@/lib/user-profile';
import { normalizeUsername } from '@/lib/username';
import {
  type VideoReviewRow,
  publicReview,
  ReviewValidationError,
} from '@/lib/video-reviews';

export const SOCIAL_TABLES = [
  'user_profiles',
  'user_follows',
  'video_review_likes',
  'video_review_reports',
] as const;
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
    `CREATE TABLE IF NOT EXISTS user_profiles (username ${text} NOT NULL PRIMARY KEY, profile_id VARCHAR(12) NOT NULL UNIQUE, nickname VARCHAR(64), nickname_norm VARCHAR(64) UNIQUE, avatar_seed VARCHAR(24), favorites_public INTEGER NOT NULL DEFAULT 0, updated_at ${time} NOT NULL)${suffix}`,
    `CREATE TABLE IF NOT EXISTS user_follows (follower ${text} NOT NULL, followee ${text} NOT NULL, created_at ${time} NOT NULL, PRIMARY KEY (follower, followee)${dialect === 'mysql' ? ', KEY idx_user_follows_followee (followee)' : ''})${suffix}`,
    ...['likes', 'reports'].map((kind) => {
      const actor = kind === 'likes' ? 'liker' : 'reporter';
      return `CREATE TABLE IF NOT EXISTS video_review_${kind} (author ${text} NOT NULL, title_norm ${text} NOT NULL, year VARCHAR(16) NOT NULL, ${actor} ${text} NOT NULL, ${kind === 'reports' ? 'reason VARCHAR(16) NOT NULL, detail VARCHAR(200) NOT NULL, ' : ''}created_at ${time} NOT NULL, PRIMARY KEY (author, title_norm, year, ${actor})${dialect === 'mysql' ? `, KEY idx_review_${kind} (${kind === 'likes' ? actor : 'created_at'})` : ''})${suffix}`;
    }),
    ...(dialect === 'sqlite'
      ? [
          'CREATE INDEX IF NOT EXISTS idx_user_follows_followee ON user_follows (followee)',
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
    favorites_public: Boolean(row.favorites_public),
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

export class ReviewSocialStorage {
  constructor(private readonly sql: SocialExecutor) {}

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
      favoritesPublic?: boolean;
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
    if (patch.favoritesPublic !== undefined) {
      columns.push('favorites_public = ?');
      params.push(patch.favoritesPublic ? 1 : 0);
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
  async getUserProfileView(
    username: string,
    viewer: string,
  ): Promise<UserProfileView | null> {
    username = normalizeUsername(username);
    viewer = normalizeUsername(viewer);
    const profile = await this.getUserProfile(username);
    if (!profile) return null;
    const [counts] = await this.sql.rows<{
      followers: number;
      following: number;
      reviews: number;
      followed: number;
    }>(
      `SELECT
      (SELECT COUNT(*) FROM user_follows WHERE followee = ?) AS followers,
      (SELECT COUNT(*) FROM user_follows WHERE follower = ?) AS following,
      (SELECT COUNT(*) FROM video_reviews WHERE username = ? AND is_public = 1) AS reviews,
      (SELECT COUNT(*) FROM user_follows WHERE follower = ? AND followee = ?) AS followed`,
      [username, username, username, viewer, username],
    );
    return {
      profileId: profile.profile_id,
      nickname: profile.nickname,
      avatarSeed: profile.avatar_seed,
      favoritesPublic: profile.favorites_public,
      isSelf: username === viewer,
      isFollowing: Number(counts.followed) > 0,
      followerCount: Number(counts.followers),
      followingCount: Number(counts.following),
      publicReviewCount: Number(counts.reviews),
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
    const column = type === 'followers' ? 'followee' : 'follower';
    const target = type === 'followers' ? 'follower' : 'followee';
    const rows = await this.sql.rows<{
      profile_id: string;
      nickname: string | null;
      avatar_seed: string | null;
      created_at: number;
    }>(
      `SELECT p.profile_id, p.nickname, p.avatar_seed, f.created_at FROM user_follows f JOIN user_profiles p ON p.username = f.${target} WHERE f.${column} = ?`,
      [normalizeUsername(username)],
    );
    return socialPage(
      rows.map((row) => ({
        profileId: row.profile_id,
        nickname: row.nickname,
        avatarSeed: row.avatar_seed,
        followedAt: Number(row.created_at),
      })),
      30,
      cursor,
      (row) => [row.followedAt, row.profileId],
    );
  }
  async enrichReviews(
    rows: VideoReviewRow[],
    viewer = '',
  ): Promise<VideoReviewRow[]> {
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
        return {
          ...row,
          profile_id: profile.profile_id,
          nickname: profile.nickname,
          avatar_seed: profile.avatar_seed,
          like_count: Number(likes.count),
          liked_by_me: Number(likes.liked) > 0,
        };
      }),
    );
  }
  async getUserPublicReviewPage(
    username: string,
    viewer: string,
    cursor?: string,
  ): Promise<PublicVideoReviewPage> {
    const rows = await this.sql.rows<VideoReviewRow>(
      'SELECT username, review_json FROM video_reviews WHERE username = ? AND is_public = 1 ORDER BY updated_at DESC, title_norm DESC, year DESC',
      [normalizeUsername(username)],
    );
    const page = socialPage(rows, 20, cursor, (row) => {
      const review = JSON.parse(row.review_json) as VideoReview;
      return [
        review.updated_at,
        JSON.stringify([review.title_norm, review.year]),
      ];
    });
    return {
      items: (await this.enrichReviews(page.items, viewer)).map(publicReview),
      nextCursor: page.nextCursor,
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
    const rows = await this.sql.rows<
      VideoReviewRow & {
        reporter: string;
        reason: ReviewReportReason;
        detail: string;
        created_at: number;
      }
    >(
      'SELECT v.username, v.review_json, r.reporter, r.reason, r.detail, r.created_at FROM video_review_reports r JOIN video_reviews v ON v.username = r.author AND v.title_norm = r.title_norm AND v.year = r.year WHERE v.is_public = 1 ORDER BY r.created_at DESC',
    );
    const groups = new Map<string, AdminReviewReportPage['items'][number]>();
    for (const row of rows) {
      const parsed = JSON.parse(row.review_json) as VideoReview;
      const key = JSON.stringify([
        row.username,
        parsed.title_norm,
        parsed.year,
      ]);
      let group = groups.get(key);
      if (!group) {
        group = {
          review: {
            ...publicReview((await this.enrichReviews([row]))[0]),
            username: row.username,
          },
          reportCount: 0,
          reasons: {},
          reports: [],
          latestReportedAt: Number(row.created_at),
        };
        groups.set(key, group);
      }
      group.reportCount++;
      group.reasons[row.reason] = (group.reasons[row.reason] ?? 0) + 1;
      if (group.reports.length < 5) {
        const p = await this.ensureUserProfile(row.reporter);
        group.reports.push({
          reporter: {
            profileId: p.profile_id,
            nickname: p.nickname,
            avatarSeed: p.avatar_seed,
          },
          reason: row.reason,
          detail: row.detail,
          created_at: Number(row.created_at),
        });
      }
    }
    return {
      ...socialPage([...groups.values()], 30, cursor, (item) => [
        item.latestReportedAt,
        JSON.stringify([
          item.review.username,
          item.review.title_norm,
          item.review.year,
        ]),
      ]),
      pendingTotal: groups.size,
    };
  }
  async getFollowReviewMessages(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
  ): Promise<FollowReviewUserMessage[]> {
    const rows = await this.sql.rows<
      VideoReviewRow & { profile_id: string; nickname: string | null }
    >(
      'SELECT v.username, v.review_json, p.profile_id, p.nickname, p.avatar_seed FROM user_follows f JOIN video_reviews v ON v.username = f.followee JOIN user_profiles p ON p.username = v.username WHERE f.follower = ? AND v.is_public = 1 AND v.updated_at > f.created_at AND v.updated_at > ? ORDER BY v.updated_at DESC',
      [normalizeUsername(username), Math.max(readAt, now - 30 * 86400000)],
    );
    const read = new Set(readIds);
    return rows.flatMap((row) => {
      const r = JSON.parse(row.review_json) as VideoReview;
      const id = `follow-review:${socialCursor([row.profile_id, r.title_norm, r.year, r.updated_at])}`;
      return read.has(id)
        ? []
        : [
            {
              id,
              type: 'follow-review' as const,
              author: {
                profileId: row.profile_id,
                nickname: row.nickname,
                avatarSeed: row.avatar_seed ?? null,
              },
              title: r.title,
              year: r.year,
              cover: r.cover,
              rating: r.rating,
              createdAt: r.updated_at,
            },
          ];
    });
  }
  async getUserSocialData(
    username: string,
  ): Promise<
    Pick<StorageUserImportData, 'profile' | 'follows' | 'likes' | 'reports'>
  > {
    username = normalizeUsername(username);
    const profile = await this.getUserProfile(username);
    const follows = await this.sql.rows<
      NonNullable<StorageUserImportData['follows']>[number]
    >('SELECT followee, created_at FROM user_follows WHERE follower = ?', [
      username,
    ]);
    const likes = await this.sql.rows<
      NonNullable<StorageUserImportData['likes']>[number]
    >(
      'SELECT author, title_norm, year, created_at FROM video_review_likes WHERE liker = ?',
      [username],
    );
    const reports = await this.sql.rows<
      NonNullable<StorageUserImportData['reports']>[number]
    >(
      'SELECT author, title_norm, year, reason, detail, created_at FROM video_review_reports WHERE reporter = ?',
      [username],
    );
    return { profile: profile ?? undefined, follows, likes, reports };
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

export function importedAvatarSeed(value: unknown): string | null {
  try {
    return validateAvatarSeed(value);
  } catch {
    return null;
  }
}

export function importedProfileValues(
  username: string,
  profile: UserProfile | undefined,
  usedIds: Set<string>,
  usedNames: Set<string>,
): unknown[] {
  let id = profile?.profile_id;
  while (!id || !/^[a-zA-Z0-9]{12}$/.test(id) || usedIds.has(id))
    id = newProfileId();
  usedIds.add(id);
  let nickname: string | null = null;
  let norm: string | null = null;
  if (profile?.nickname) {
    try {
      const v = validateNickname(profile.nickname, { allowReserved: true });
      if (!usedNames.has(v.nicknameNorm)) {
        nickname = v.nickname;
        norm = v.nicknameNorm;
        usedNames.add(norm);
      }
    } catch {
      // 旧备份昵称按当前规则重新校验。
    }
  }
  return [
    normalizeUsername(username),
    id,
    nickname,
    norm,
    importedAvatarSeed(profile?.avatar_seed),
    profile?.favorites_public ? 1 : 0,
    profile?.updated_at ?? Date.now(),
  ];
}
