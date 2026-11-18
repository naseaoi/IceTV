import type {
  AnnualRecapShareState,
  PublicAnnualReport,
} from '@/features/playback-stats/types';
import {
  followRecapMessageId,
  parseFollowRecapMessageId,
  parseFollowRecapSortKey,
} from '@/lib/annual-recap-identity';
import type { FollowReviewQuery } from '@/lib/follow-review-identity';
import type { FollowRecapUserMessage } from '@/lib/message-types';
import type { SocialExecutor } from '@/lib/review-social-storage';
import { normalizeUsername } from '@/lib/username';
import { watchLevelForMs } from '@/lib/watch-level';

export type StoredAnnualRecap = AnnualRecapShareState & {
  report: PublicAnnualReport;
};

type RecapRow = {
  year: number;
  hide_rhythm: number;
  report_json: string;
  published_at: number;
  updated_at: number;
};

export function annualRecapSchema(dialect: 'sqlite' | 'mysql'): string {
  const mysql = dialect === 'mysql';
  return `CREATE TABLE IF NOT EXISTS user_annual_recaps (
    username ${mysql ? 'VARCHAR(191)' : 'TEXT'} NOT NULL,
    year INTEGER NOT NULL, time_zone VARCHAR(64) NOT NULL, hide_rhythm INTEGER NOT NULL,
    report_json ${mysql ? 'LONGTEXT' : 'TEXT'} NOT NULL,
    published_at ${mysql ? 'BIGINT' : 'INTEGER'} NOT NULL,
    updated_at ${mysql ? 'BIGINT' : 'INTEGER'} NOT NULL,
    PRIMARY KEY (username, year)
  )${mysql ? ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin' : ''}`;
}

function recapFromRow(row: RecapRow): StoredAnnualRecap {
  return {
    year: Number(row.year),
    published: true,
    hideRhythm: !!Number(row.hide_rhythm),
    publishedAt: Number(row.published_at),
    updatedAt: Number(row.updated_at),
    report: JSON.parse(row.report_json) as PublicAnnualReport,
  };
}

export class AnnualRecapStorage {
  constructor(private readonly sql: SocialExecutor) {}

  async getAnnualRecap(
    username: string,
    year: number,
  ): Promise<StoredAnnualRecap | null> {
    const [row] = await this.sql.rows<RecapRow>(
      'SELECT year, hide_rhythm, report_json, published_at, updated_at FROM user_annual_recaps WHERE username = ? AND year = ?',
      [normalizeUsername(username), year],
    );
    return row ? recapFromRow(row) : null;
  }

  async getAnnualRecapYears(username: string): Promise<number[]> {
    const rows = await this.sql.rows<{ year: number }>(
      'SELECT year FROM user_annual_recaps WHERE username = ? ORDER BY year DESC',
      [normalizeUsername(username)],
    );
    return rows.map((row) => Number(row.year));
  }

  async saveAnnualRecap(
    username: string,
    report: PublicAnnualReport,
    now: number,
    refresh?: { publishedAt: number; updatedAt: number },
  ): Promise<void> {
    const values = [
      report.timeZone,
      Number(report.rhythmHidden),
      JSON.stringify(report),
      now,
    ];
    if (refresh) {
      // 条件刷新不重新创建已取消的公开记录，也不覆盖并发修改的隐私设置。
      await this.sql.run(
        'UPDATE user_annual_recaps SET time_zone = ?, hide_rhythm = ?, report_json = ?, updated_at = ? WHERE username = ? AND year = ? AND published_at = ? AND updated_at = ?',
        [
          ...values,
          normalizeUsername(username),
          report.year,
          refresh.publishedAt,
          refresh.updatedAt,
        ],
      );
      return;
    }
    const update =
      this.sql.dialect === 'sqlite'
        ? 'ON CONFLICT(username, year) DO UPDATE SET time_zone = excluded.time_zone, hide_rhythm = excluded.hide_rhythm, report_json = excluded.report_json, updated_at = excluded.updated_at'
        : 'ON DUPLICATE KEY UPDATE time_zone = VALUES(time_zone), hide_rhythm = VALUES(hide_rhythm), report_json = VALUES(report_json), updated_at = VALUES(updated_at)';
    await this.sql.run(
      `INSERT INTO user_annual_recaps (username, year, time_zone, hide_rhythm, report_json, published_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ${update}`,
      [
        normalizeUsername(username),
        report.year,
        report.timeZone,
        Number(report.rhythmHidden),
        JSON.stringify(report),
        now,
        now,
      ],
    );
  }

  async deleteAnnualRecap(username: string, year: number): Promise<void> {
    await this.sql.run(
      'DELETE FROM user_annual_recaps WHERE username = ? AND year = ?',
      [normalizeUsername(username), year],
    );
  }

  private where(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
  ) {
    const ids = readIds
      .map(parseFollowRecapMessageId)
      .filter((id) => id !== null);
    return {
      from: `FROM user_follows f JOIN user_annual_recaps r ON r.username = f.followee JOIN user_profiles p ON p.username = r.username LEFT JOIN user_watch_totals wt ON wt.username = p.username
      WHERE f.follower = ? AND r.published_at > f.created_at AND r.published_at > ?
      ${ids.map(() => 'AND NOT (p.profile_id = ? AND r.year = ? AND r.published_at = ?)').join(' ')}`,
      params: [
        normalizeUsername(username),
        Math.max(readAt, now - 30 * 86400000),
        ...ids.flat(),
      ],
    };
  }

  async getFollowRecapMessageCount(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
  ): Promise<number> {
    const { from, params } = this.where(username, readAt, readIds, now);
    const [row] = await this.sql.rows<{ count: number }>(
      `SELECT COUNT(*) AS count ${from}`,
      params,
    );
    return Number(row.count);
  }

  async getFollowRecapMessages(
    username: string,
    readAt: number,
    readIds: string[],
    now: number,
    query: FollowReviewQuery = {},
  ): Promise<FollowRecapUserMessage[]> {
    const { from, params } = this.where(username, readAt, readIds, now);
    let filter = '';
    if (query.id) {
      const id = parseFollowRecapMessageId(query.id);
      if (!id) return [];
      filter += ' AND p.profile_id = ? AND r.year = ? AND r.published_at = ?';
      params.push(...id);
    }
    if (query.before) {
      const { createdAt, key } = query.before;
      const id = parseFollowRecapSortKey(key);
      if (id) {
        filter +=
          ' AND (r.published_at < ? OR (r.published_at = ? AND (p.profile_id, r.year) < (?, ?)))';
        params.push(createdAt, createdAt, ...id);
      } else {
        filter +=
          key > 'follow-recap:'
            ? ' AND r.published_at <= ?'
            : ' AND r.published_at < ?';
        params.push(createdAt);
      }
    }
    const rows = await this.sql.rows<{
      profile_id: string;
      nickname: string | null;
      avatar_seed: string | null;
      counted_ms: number | null;
      year: number;
      published_at: number;
    }>(
      `SELECT p.profile_id, p.nickname, p.avatar_seed, wt.counted_ms, r.year, r.published_at ${from}${filter} ORDER BY r.published_at DESC, p.profile_id DESC, r.year DESC LIMIT ?`,
      [...params, Math.max(1, Math.min(201, Math.floor(query.limit ?? 30)))],
    );
    return rows.map((row) => ({
      type: 'follow-recap',
      id: followRecapMessageId(
        row.profile_id,
        Number(row.year),
        Number(row.published_at),
      ),
      author: {
        profileId: row.profile_id,
        nickname: row.nickname,
        avatarSeed: row.avatar_seed,
        level: watchLevelForMs(Number(row.counted_ms ?? 0)),
      },
      year: Number(row.year),
      at: Number(row.published_at),
      createdAt: Number(row.published_at),
    }));
  }
}
