import type { FollowReviewQuery } from '@/lib/follow-review-identity';
import type {
  NewFollowerUserMessage,
  ReviewLikeUserMessage,
} from '@/lib/message-types';
import type { SocialExecutor } from '@/lib/review-social-storage';
import {
  type SocialNotificationKind,
  parseSocialNotificationId,
  parseSocialNotificationSortKey,
  socialNotificationId,
} from '@/lib/social-notification-identity';
import type { VideoReview } from '@/lib/types';
import { normalizeUsername } from '@/lib/username';

type MessageRow = {
  profile_id: string;
  nickname: string | null;
  avatar_seed: string | null;
  title_norm: string;
  year: string;
  created_at: number;
  liker_id: string;
  liker_nickname: string | null;
  liker_avatar: string | null;
  like_count: number;
  review_json: string;
};

export class SocialNotificationStorage {
  constructor(private readonly sql: SocialExecutor) {}

  private source(kind: SocialNotificationKind, username: string, now: number) {
    username = normalizeUsername(username);
    if (kind === 'new-follower')
      return {
        from: `FROM (SELECT p.profile_id, p.nickname, p.avatar_seed, '' AS title_norm, '' AS year, f.created_at FROM user_follows f JOIN user_profiles p ON p.username = f.follower WHERE f.followee = ? AND f.follower <> ? AND f.created_at > ?) n`,
        params: [username, username, now - 30 * 86400000] as unknown[],
      };
    // 聚合先于已读排除：新点赞到达后重新生成消息，计数仍包含整个窗口内的点赞者。
    return {
      from: `FROM (SELECT p.profile_id, g.title_norm, g.year, g.created_at, g.like_count, v.review_json,
        liker.profile_id AS liker_id, liker.nickname AS liker_nickname, liker.avatar_seed AS liker_avatar
        FROM (SELECT author, title_norm, year, MAX(created_at) AS created_at, COUNT(*) AS like_count FROM video_review_likes WHERE author = ? AND liker <> ? AND created_at > ? GROUP BY author, title_norm, year) g
        JOIN video_reviews v ON v.username = g.author AND v.title_norm = g.title_norm AND v.year = g.year AND v.is_public = 1
        JOIN user_profiles p ON p.username = g.author
        JOIN video_review_likes latest ON latest.author = g.author AND latest.title_norm = g.title_norm AND latest.year = g.year AND latest.created_at = g.created_at AND latest.liker <> g.author
        JOIN user_profiles liker ON liker.username = latest.liker
        WHERE NOT EXISTS (SELECT 1 FROM video_review_likes tie WHERE tie.author = g.author AND tie.title_norm = g.title_norm AND tie.year = g.year AND tie.created_at = g.created_at AND tie.liker <> g.author AND tie.liker > latest.liker)) n`,
      params: [username, username, now - 30 * 86400000] as unknown[],
    };
  }

  private where(
    kind: SocialNotificationKind,
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
    query: FollowReviewQuery = {},
  ) {
    const { from, params } = this.source(kind, username, now);
    let filter = ' WHERE n.created_at > ?';
    params.push(readAt);
    for (const id of readIds) {
      const identity = parseSocialNotificationId(kind, id);
      if (!identity) continue;
      filter +=
        ' AND NOT (n.profile_id = ? AND n.title_norm = ? AND n.year = ? AND n.created_at = ?)';
      params.push(...identity);
    }
    if (query.id) {
      const identity = parseSocialNotificationId(kind, query.id);
      if (!identity) filter += ' AND 1 = 0';
      else {
        filter +=
          ' AND n.profile_id = ? AND n.title_norm = ? AND n.year = ? AND n.created_at = ?';
        params.push(...identity);
      }
    }
    if (query.before) {
      const { key, createdAt } = query.before;
      const identity = parseSocialNotificationSortKey(kind, key);
      if (identity) {
        filter +=
          ' AND (n.created_at < ? OR (n.created_at = ? AND (n.profile_id, n.title_norm, n.year) < (?, ?, ?)))';
        params.push(createdAt, createdAt, ...identity);
      } else {
        filter +=
          key > `${kind}:` ? ' AND n.created_at <= ?' : ' AND n.created_at < ?';
        params.push(createdAt);
      }
    }
    return { from: from + filter, params };
  }

  async getSocialNotificationCount(
    kind: SocialNotificationKind,
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
  ): Promise<number> {
    const { from, params } = this.where(kind, username, readAt, readIds, now);
    const [row] = await this.sql.rows<{ count: number }>(
      `SELECT COUNT(*) AS count ${from}`,
      params,
    );
    return Number(row.count);
  }

  async getSocialNotifications(
    kind: SocialNotificationKind,
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
    query: FollowReviewQuery = {},
  ): Promise<(NewFollowerUserMessage | ReviewLikeUserMessage)[]> {
    const { from, params } = this.where(
      kind,
      username,
      readAt,
      readIds,
      now,
      query,
    );
    const rows = await this.sql.rows<MessageRow>(
      `SELECT n.* ${from} ORDER BY n.created_at DESC, n.profile_id DESC, n.title_norm DESC, n.year DESC LIMIT ?`,
      [...params, Math.max(1, Math.min(201, Math.floor(query.limit ?? 30)))],
    );
    return rows.map((row) => {
      const createdAt = Number(row.created_at);
      const id = socialNotificationId(kind, [
        row.profile_id,
        row.title_norm,
        row.year,
        createdAt,
      ]);
      if (kind === 'new-follower')
        return {
          id,
          type: kind,
          follower: {
            profileId: row.profile_id,
            nickname: row.nickname,
            avatarSeed: row.avatar_seed,
          },
          createdAt,
        };
      const review = JSON.parse(row.review_json) as VideoReview;
      return {
        id,
        type: kind,
        latestLiker: {
          profileId: row.liker_id,
          nickname: row.liker_nickname,
          avatarSeed: row.liker_avatar,
        },
        likeCount: Number(row.like_count),
        review: {
          profileId: row.profile_id,
          title_norm: row.title_norm,
          year: row.year,
        },
        title: review.title,
        year: review.year,
        cover: review.cover,
        createdAt,
      };
    });
  }
}
