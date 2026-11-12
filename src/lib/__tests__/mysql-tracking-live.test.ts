/** @jest-environment node */

import {
  assertAnnualRecapMessages,
  assertAnnualRecapStorage,
} from '@/lib/__tests__/__fixtures__/annual-recap-contract';
import {
  assertBatchDeletePlayRecords,
  assertBatchReadPlayRecords,
  assertUpdatedPlayRecordPage,
} from '@/lib/__tests__/__fixtures__/play-record-page-contract';
import { assertPlaybackAnnualData } from '@/lib/__tests__/__fixtures__/playback-annual-contract';
import { assertPlaybackPeriodRange } from '@/lib/__tests__/__fixtures__/playback-period-contract';
import { assertReviewReplies } from '@/lib/__tests__/__fixtures__/review-reply-contract';
import { assertSocialNotifications } from '@/lib/__tests__/__fixtures__/social-notification-contract';
import { assertStatsReuse } from '@/lib/__tests__/__fixtures__/stats-reuse-contract';
import { userNoticeContract } from '@/lib/__tests__/__fixtures__/user-notice-contract';
import { assertWatchHistoryContract } from '@/lib/__tests__/__fixtures__/watch-history-contract';

import { MySqlStorage } from '../mysql.db';
import type { Favorite, PlayRecord } from '../types';
import { announcementContract } from './__fixtures__/announcement-contract';
import { inviteCodeBatchContract } from './__fixtures__/invite-code-contract';
import { listsContract } from './__fixtures__/lists-contract';
import { resetMysqlTestData } from './__fixtures__/mysql-test-data';
import { oauthIdentityContract } from './__fixtures__/oauth-identity-contract';
import { assertTrackingCalendar } from './__fixtures__/tracking-calendar-contract';
import { userDanmakuContract } from './__fixtures__/user-danmaku-contract';
import {
  assertActivityAndReportPagination,
  assertFollowPagination,
  assertPublicReviewRoles,
  videoReview,
} from './__fixtures__/video-review-contract';

const liveUrl = (process.env.MYSQL_TEST_URL || '').trim();
const describeLive = liveUrl ? describe : describe.skip;

const basePlayRecord: PlayRecord = {
  title: '剧集',
  source_name: '源',
  year: '2026',
  cover: '',
  index: 1,
  total_episodes: 12,
  play_time: 0,
  total_time: 0,
  save_time: 1,
};

const baseFavorite: Favorite = {
  source_name: '源',
  total_episodes: 12,
  title: '剧集',
  year: '2026',
  cover: '',
  save_time: 1,
};

describeLive('MySQL 追更查询（真实实例）', () => {
  let storage: MySqlStorage;

  beforeAll(() => {
    storage = new MySqlStorage(liveUrl);
  });

  beforeEach(async () => resetMysqlTestData(storage));

  afterAll(async () => {
    await (
      storage as unknown as { pool: { end: () => Promise<void> } }
    ).pool.end();
  });

  it('单次 JOIN 保留多组顺序、无组用户及删号边界', async () => {
    await storage.registerUser('access-reader', 'password');
    await storage.updateUserAccess(['access-reader'], {
      role: 'admin',
      tags: ['second', 'first'],
      enabledApis: ['source'],
    });
    const pool = (storage as unknown as { pool: import('mysql2/promise').Pool })
      .pool;
    const query = jest.spyOn(pool, 'query');
    expect(await storage.getUserAccess('ACCESS-READER')).toMatchObject({
      role: 'admin',
      tags: ['second', 'first'],
      enabledApis: ['source'],
    });
    expect(query).toHaveBeenCalledTimes(1);
    query.mockRestore();
    await storage.updateUserAccess(['access-reader'], {
      tags: [],
      enabledApis: [],
      banned: true,
    });
    expect(await storage.getUserAccess('access-reader')).toMatchObject({
      banned: true,
      tags: undefined,
      enabledApis: undefined,
    });
    await pool.execute('DELETE FROM users WHERE username = ?', [
      'access-reader',
    ]);
    expect(await storage.getUserAccess('access-reader')).toBeNull();
  });

  it('批量读取隔离用户并省略缺失键', async () => {
    await assertBatchReadPlayRecords(storage);
  });

  describe('管理通知契约', () => {
    userNoticeContract(() => storage);
  });

  it('管理通知失败回滚删除，并发重试只生成一次通知', async () => {
    await storage.registerUser('notice-rollback', 'password');
    await storage.setVideoReview('notice-rollback', videoReview);
    const pool = (storage as unknown as { pool: import('mysql2/promise').Pool })
      .pool;
    await pool.query(
      "CREATE TRIGGER fail_notice BEFORE INSERT ON user_notice_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'notice failed'",
    );
    try {
      await expect(
        storage.deleteVideoReview(
          'notice-rollback',
          videoReview.title_norm,
          videoReview.year,
          true,
        ),
      ).rejects.toThrow('notice failed');
      expect(
        await storage.getVideoReview(
          'notice-rollback',
          videoReview.title_norm,
          videoReview.year,
        ),
      ).not.toBeNull();
    } finally {
      await pool.query('DROP TRIGGER fail_notice');
    }
    await Promise.all(
      [1, 2].map(() =>
        storage.deleteVideoReview(
          'notice-rollback',
          videoReview.title_norm,
          videoReview.year,
          true,
        ),
      ),
    );
    expect(
      await storage.getUserNoticeCount('notice-rollback', 0, [], Date.now()),
    ).toBe(1);
    await Promise.all(
      [1, 2].map(() =>
        storage.updateUserAccess(['notice-rollback'], { role: 'admin' }),
      ),
    );
    expect(
      await storage.getUserNoticeCount('notice-rollback', 0, [], Date.now()),
    ).toBe(2);
  });

  describe('announcements', () => {
    announcementContract(() => storage);
  });

  it('评价首次公开迁移回滚、并发重试与一次性回填保留旧消息身份', async () => {
    const impl = storage as unknown as {
      pool: import('mysql2/promise').Pool;
      migrateReviewFirstPublished(): Promise<void>;
    };
    for (const username of ['author', 'reader'])
      await storage.ensureUserProfile(username);
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      await storage.setUserFollow('reader', 'author', true);
      await storage.setVideoReview('author', videoReview);
      const [before] = await storage.getFollowReviewMessages(
        'reader',
        0,
        [],
        3000,
      );
      await storage.setVideoReview('author', {
        ...videoReview,
        title_norm: 'old-private',
        is_public: false,
      });
      await impl.pool.execute(
        'UPDATE video_reviews SET first_published_at = NULL',
      );
      await impl.pool.execute('DELETE FROM storage_migrations WHERE name = ?', [
        'review_first_published_v1',
      ]);
      await impl.pool.query(
        "CREATE TRIGGER interrupt_review_migration BEFORE UPDATE ON storage_migrations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'interrupt'",
      );
      try {
        await expect(impl.migrateReviewFirstPublished()).rejects.toThrow(
          'interrupt',
        );
        const [rows] = await impl.pool.query(
          'SELECT first_published_at FROM video_reviews',
        );
        expect(rows).toEqual([
          { first_published_at: null },
          { first_published_at: null },
        ]);
      } finally {
        await impl.pool.query('DROP TRIGGER interrupt_review_migration');
      }
      await Promise.all([
        impl.migrateReviewFirstPublished(),
        impl.migrateReviewFirstPublished(),
      ]);
      expect(
        await storage.getFollowReviewMessages('reader', 0, [before.id], 3000),
      ).toEqual([]);
      await storage.setVideoReview('author', {
        ...videoReview,
        title_norm: 'old-private',
        updated_at: 8000,
      });
      expect(
        await storage.getFollowReviewMessageCount('reader', 2000, [], 9000),
      ).toBe(0);
      await storage.setVideoReview('author', {
        ...videoReview,
        title_norm: 'new-draft',
        is_public: false,
        updated_at: 9000,
      });
      await impl.migrateReviewFirstPublished();
      const [rows] = await impl.pool.query(
        "SELECT first_published_at FROM video_reviews WHERE title_norm = 'new-draft'",
      );
      expect(rows).toEqual([{ first_published_at: null }]);
    } finally {
      clock.mockRestore();
    }
  });

  it('历史与桶统计双后端契约', async () => {
    await assertWatchHistoryContract(storage);
  });

  it('历史迁移中断回滚，重试按大小写身份与最新行回填，完成标记阻止复活', async () => {
    const impl = storage as unknown as {
      pool: import('mysql2/promise').Pool;
      migrateWatchHistory(): Promise<void>;
    };
    const base = {
      id: 'migrate-session-a',
      source: 'Source',
      video_id: 'video',
      title: '旧作品',
      source_name: '源',
      cover: '',
      year: '2026',
      episode_index: 1,
      started_at: 100,
      ended_at: 200,
      watch_seconds: 10,
      last_position: 10,
      total_time: 100,
      created_at: 100,
      updated_at: 200,
    };
    await storage.setPlaybackSession('migration-user', base);
    await storage.setPlaybackSession('migration-user', {
      ...base,
      id: 'migrate-session-z',
      started_at: 150,
      last_position: 70,
    });
    await storage.setPlaybackSession('migration-user', {
      ...base,
      id: 'migrate-session-other',
      source: 'source',
    });
    await storage.setPlayRecord('migration-user', 'Source+video', {
      ...basePlayRecord,
      total_episodes: 24,
      group_label: '第二季',
      group_index: 3,
      group_total: 12,
    });
    await impl.pool.execute('DELETE FROM storage_migrations WHERE name = ?', [
      'watch_history_v1',
    ]);
    await impl.pool.query(
      "CREATE TRIGGER interrupt_history_migration BEFORE UPDATE ON storage_migrations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'interrupt'",
    );
    try {
      await expect(impl.migrateWatchHistory()).rejects.toMatchObject({
        message: 'interrupt',
      });
      expect(
        await storage.getWatchHistoryPage('migration-user', { limit: 10 }),
      ).toEqual([]);
    } finally {
      await impl.pool.query('DROP TRIGGER interrupt_history_migration');
    }
    await Promise.all([impl.migrateWatchHistory(), impl.migrateWatchHistory()]);
    const rows = await storage.getWatchHistoryPage('migration-user', {
      limit: 10,
    });
    expect(rows).toHaveLength(2);
    const row = rows.find((row) => row.source === 'Source')!;
    expect(row).toMatchObject({
      position: 70,
      first_watched_at: 100,
      total_episodes: 24,
      group_label: '第二季',
    });
    for (const item of rows)
      await storage.deleteWatchHistoryEntry('migration-user', item.id);
    await impl.migrateWatchHistory();
    expect(
      await storage.getWatchHistoryPage('migration-user', { limit: 10 }),
    ).toEqual([]);
  });

  it('并发重复桶写入以最大值统计并返回同一个历史身份', async () => {
    const session = {
      id: 'concurrent-session',
      source: 'source',
      video_id: 'video',
      title: '作品',
      source_name: '源',
      cover: '',
      year: '2026',
      episode_index: 1,
      started_at: 900000,
      ended_at: 960000,
      watch_seconds: 0,
      last_position: 30,
      total_time: 100,
      created_at: 900000,
      updated_at: 960000,
    };
    const ids = await Promise.all(
      [3000, 1000, 4000, 2000].map((watch_ms) =>
        storage.saveWatchSessionReport(
          'concurrent-user',
          session,
          [{ start: 900000, watch_ms }],
          { total_episodes: 1 },
        ),
      ),
    );
    expect(new Set(ids).size).toBe(1);
    expect(
      (
        await storage.getPlaybackPeriodSessions('concurrent-user', 0, 1000000)
      )[0].watch_seconds,
    ).toBe(4);
    expect(
      await storage.getWatchHistoryPage('concurrent-user', { limit: 10 }),
    ).toHaveLength(1);
  });

  it('筛选分页与追更计数及客户端判定保持一致', async () => {
    await assertUpdatedPlayRecordPage(storage);
  });

  it('批量删除隔离用户并同步影响追更计数', async () => {
    await assertBatchDeletePlayRecords(storage);
  });

  it('新粉丝与点赞通知双后端契约', async () => {
    await assertSocialNotifications(storage, 'mysql-notification');
  });

  it('公开评价作者角色双后端契约', async () => {
    await assertPublicReviewRoles(storage, 'mysql-review-role');
  });

  it('回复双后端契约', async () => {
    await assertReviewReplies(storage, 'mysql-reply');
  });

  it('isolates current route semantics while retaining and purging both versions', async () => {
    await storage.recordSourceRouteStat({
      source: 'versioned',
      routeMode: 'browser',
      success: true,
      eventAt: Date.UTC(2026, 0, 8),
    });
    await storage.recordSourceRouteStat({
      source: 'versioned',
      routeMode: 'server',
      success: false,
      eventAt: Date.UTC(2026, 0, 8),
    });
    const pool = (storage as unknown as { pool: import('mysql2/promise').Pool })
      .pool;
    for (const mode of ['browser', 'server']) {
      await pool.execute(
        'INSERT INTO source_route_stats (source, route_mode, bucket_date, success_count, failure_count, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['versioned', mode, '2026-01-08', 99, 99, 1],
      );
    }
    expect(await storage.getSourceRouteStats('2026-01-01')).toEqual(
      expect.arrayContaining([
        {
          source: 'versioned',
          routeMode: 'browser',
          successCount: 1,
          failureCount: 0,
        },
        {
          source: 'versioned',
          routeMode: 'server',
          successCount: 0,
          failureCount: 1,
        },
      ]),
    );
    expect(await storage.getSourceRouteStats('2026-01-01')).toHaveLength(2);
    expect(
      (await storage.getAllSourceRouteStatBuckets()).map(
        (row) => row.routeMode,
      ),
    ).toEqual(
      expect.arrayContaining(['browser', 'server', 'browser-v2', 'server-v2']),
    );
    await storage.purgeSourceRouteStatsBefore('2026-01-08');
    expect(await storage.getAllSourceRouteStatBuckets()).toHaveLength(4);
    await storage.purgeSourceRouteStatsBefore('2026-01-09');
    expect(await storage.getAllSourceRouteStatBuckets()).toEqual([]);
  });

  it('keeps concurrent search increments and play counters without multiplying reporter-days', async () => {
    const row = {
      source: 'concurrent',
      bucketDate: '2026-01-02',
      okCount: 1,
      emptyCount: 0,
      errorCount: 0,
      latencyMsSum: 10,
      latencySamples: 1,
    };
    await Promise.all(
      Array.from({ length: 12 }, () =>
        storage.recordSourceHealthSearchBatch([row]),
      ),
    );
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        storage.recordSourcePlayReport({
          source: row.source,
          bucketDate: row.bucketDate,
          reporter: 'same',
          success: index < 4,
        }),
      ),
    );
    expect(await storage.getSourceHealthSearchDaily(row.bucketDate)).toEqual([
      { ...row, okCount: 12, latencyMsSum: 120, latencySamples: 12 },
    ]);
    expect(await storage.getSourcePlayReporterSummary(row.bucketDate)).toEqual([
      {
        source: row.source,
        successReporterDays: 1,
        failureReporterDays: 0,
        lastSuccessDate: row.bucketDate,
      },
    ]);
    const pool = (storage as unknown as { pool: import('mysql2/promise').Pool })
      .pool;
    const [rows] = await pool.query(
      'SELECT success_count, failure_count FROM source_health_play WHERE source = ?',
      [row.source],
    );
    expect(rows).toEqual([{ success_count: 4, failure_count: 8 }]);
  });

  it('rolls back the complete health search batch on a later row failure', async () => {
    const row = {
      source: 'alpha',
      bucketDate: '2026-01-02',
      okCount: 1,
      emptyCount: 0,
      errorCount: 0,
      latencyMsSum: 10,
      latencySamples: 1,
    };
    await storage.recordSourceHealthSearchBatch([row]);
    const broken = {
      ...row,
      get source(): string {
        throw new Error('batch failure');
      },
    };
    await expect(
      storage.recordSourceHealthSearchBatch([
        row,
        { ...row, source: 'beta' },
        broken,
      ]),
    ).rejects.toThrow('batch failure');
    expect(await storage.getSourceHealthSearchDaily('2026-01-01')).toEqual([
      row,
    ]);
  });

  it('accumulates health search rows, normalizes counters and retains date boundaries', async () => {
    const row = {
      source: 'alpha',
      bucketDate: '2026-01-02',
      okCount: 1,
      emptyCount: 2,
      errorCount: 3,
      latencyMsSum: 12.5,
      latencySamples: 3,
    };
    await storage.recordSourceHealthSearchBatch([]);
    await storage.recordSourceHealthSearchBatch([
      { ...row, source: 'zeta', bucketDate: '2026-01-03' },
      { ...row, source: 'beta' },
      { ...row, bucketDate: '2026-01-01' },
      { ...row, source: ' alpha ' },
      row,
      { ...row, source: ' ' },
      {
        ...row,
        source: ' ' + 'x'.repeat(200) + ' ',
        okCount: NaN,
        emptyCount: Infinity,
        errorCount: -1,
        latencyMsSum: -Infinity,
        latencySamples: -3,
      },
    ]);
    await storage.recordSourceHealthSearchBatch([row]);
    expect(await storage.getSourceHealthSearchDaily('2026-01-02')).toEqual([
      {
        ...row,
        okCount: 3,
        emptyCount: 6,
        errorCount: 9,
        latencyMsSum: 37.5,
        latencySamples: 9,
      },
      { ...row, source: 'beta' },
      {
        ...row,
        source: 'x'.repeat(191),
        okCount: 0,
        emptyCount: 0,
        errorCount: 0,
        latencyMsSum: 0,
        latencySamples: 0,
      },
      { ...row, source: 'zeta', bucketDate: '2026-01-03' },
    ]);
    await storage.purgeSourceHealthBefore('2026-01-02');
    expect(await storage.getSourceHealthSearchDaily('2026-01-01')).toHaveLength(
      4,
    );
    await storage.purgeSourceHealthBefore('2026-01-04');
    expect(await storage.getSourceHealthSearchDaily('2026-01-01')).toEqual([]);
  });

  it('aggregates reporter-days in SQL with success precedence and clears health state', async () => {
    const report = {
      source: ' alpha ',
      bucketDate: '2026-01-02',
      reporter: 'a',
      success: false,
    };
    for (const success of [false, false, true, true, false])
      await storage.recordSourcePlayReport({ ...report, success });
    for (let i = 0; i < 3; i++)
      await storage.recordSourcePlayReport({ ...report, reporter: 'b' });
    await storage.recordSourcePlayReport({
      ...report,
      bucketDate: '2026-01-03',
      success: true,
    });
    await storage.recordSourcePlayReport({
      ...report,
      bucketDate: '2026-01-01',
      success: true,
    });
    await storage.recordSourcePlayReport({ ...report, source: 'beta' });
    const summaries = [
      {
        source: 'alpha',
        successReporterDays: 2,
        failureReporterDays: 1,
        lastSuccessDate: '2026-01-03',
      },
      {
        source: 'beta',
        successReporterDays: 0,
        failureReporterDays: 1,
        lastSuccessDate: null,
      },
    ];
    expect(await storage.getSourcePlayReporterSummary('2026-01-02')).toEqual(
      summaries,
    );
    await storage.purgeSourceHealthBefore('2026-01-02');
    expect(await storage.getSourcePlayReporterSummary('2026-01-01')).toEqual(
      summaries,
    );
    expect(await storage.getSourcePlayReporterSummary('2026-01-04')).toEqual(
      [],
    );
    await storage.purgeSourceHealthBefore('2026-01-04');
    expect(await storage.getSourceHealthSearchDaily('2026-01-01')).toEqual([]);
    expect(await storage.getSourcePlayReporterSummary('2026-01-01')).toEqual(
      [],
    );
  });
  describe('邀请码批量事务契约（真实实例）', () => {
    inviteCodeBatchContract(() => storage, resetMysqlTestData);
  });

  it('邀请码真实 SQL 分页、并发占用与过期过滤一致', async () => {
    await storage.setAdminConfig({
      UserConfig: {},
    } as import('@/types/admin').AdminConfig);
    const prefix = `INVITE-${Date.now()}`;
    const codes = ['A', 'B', 'C'].map((suffix) => `${prefix}-${suffix}`);
    try {
      for (const code of codes)
        await storage.createInviteCode({
          code,
          createdAt: Date.now(),
          expiresAt: Date.now() + 86400000,
          createdBy: 'owner',
          maxUses: 2,
        });
      const results = await Promise.all(
        Array.from({ length: 15 }, () =>
          storage.reserveInviteCodeUse(codes[0]),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(2);
      const exhausted = await storage.queryInviteCodes({ filter: 'exhausted' });
      expect(exhausted.items.some((item) => item.code === codes[0])).toBe(true);
      const first = await storage.queryInviteCodes({
        filter: 'active',
        limit: 1,
      });
      expect(first.nextCursor).toBeTruthy();
      const second = await storage.queryInviteCodes({
        filter: 'active',
        limit: 1,
        cursor: first.nextCursor!,
      });
      expect(second.items[0].code).not.toBe(first.items[0].code);
      await expect(
        storage.queryInviteCodes({ filter: 'all', cursor: first.nextCursor! }),
      ).rejects.toThrow('邀请码游标无效');
      await storage.releaseInviteCodeUse(codes[0]);
      expect(await storage.reserveInviteCodeUse(codes[0])).toBe(true);
      await storage.deleteInviteCode(codes[2]);
      await storage.createInviteCode({
        code: codes[2],
        createdAt: 1,
        expiresAt: 1,
        createdBy: 'owner',
      });
      expect(await storage.reserveInviteCodeUse(codes[2])).toBe(false);
    } finally {
      for (const code of codes) await storage.deleteInviteCode(code);
    }
  });

  it('邀请码真实 SQL 迁移在并发实例下保持用量并剥离配置', async () => {
    const { MysqlInviteCodeStore } =
      await import('@/lib/mysql-invite-code-store');
    const pool = (storage as unknown as { pool: import('mysql2/promise').Pool })
      .pool;
    const code = `MIGRATE-${Date.now()}`;
    await storage.setAdminConfig({
      UserConfig: {
        InviteCodes: [
          {
            code,
            createdAt: 1,
            expiresAt: Date.now() + 86400000,
            createdBy: 'owner',
            maxUses: 10,
            usedCount: 2,
          },
        ],
      },
    } as import('@/types/admin').AdminConfig);
    await pool.execute(
      'INSERT INTO invite_code_usage (code, used_count) VALUES (?, ?)',
      [code, 4],
    );
    try {
      await Promise.all([
        new MysqlInviteCodeStore(pool).migrate(),
        new MysqlInviteCodeStore(pool).migrate(),
      ]);
      expect(
        (await storage.getAllInviteCodes()).find((item) => item.code === code)
          ?.usedCount,
      ).toBe(4);
      expect(
        (await storage.getAdminConfig())?.UserConfig.InviteCodes,
      ).toBeUndefined();
      const [rows] = await pool.query(
        'SELECT code FROM invite_code_usage WHERE code = ?',
        [code],
      );
      expect(rows).toEqual([]);
      await storage.deleteInviteCode(code);
      await new MysqlInviteCodeStore(pool).migrate();
      expect(
        (await storage.getAllInviteCodes()).some((item) => item.code === code),
      ).toBe(false);
    } finally {
      await storage.deleteInviteCode(code);
    }
  });

  it('paginates activity and report groups in real SQL', async () => {
    await assertActivityAndReportPagination(storage, `activity-${Date.now()}`);
  });

  const makeRecord = (
    total: number,
    baseline: number,
    detectedAt: number,
    extra: Partial<PlayRecord> = {},
  ): PlayRecord => ({
    ...basePlayRecord,
    index: 1,
    total_episodes: total,
    save_time: detectedAt,
    metadata_checked_at: detectedAt,
    update_baseline_episodes: baseline,
    tracking_enabled: true,
    ...extra,
  });

  it('paginates own and work reviews in real SQL with tied timestamps and wildcard years', async () => {
    const prefix = `review-page-${Date.now()}`;
    const titleNorm = prefix;
    const authors = Array.from({ length: 25 }, (_, i) => `${prefix}-${i}`);
    try {
      for (const [index, author] of authors.entries()) {
        await storage.ensureUserProfile(author);
        await storage.setVideoReview(author, {
          ...videoReview,
          title_norm: titleNorm,
          year: index % 2 ? '' : '2026',
        });
        await storage.setVideoReview(prefix, {
          ...videoReview,
          title_norm: `${prefix}-${String(index).padStart(2, '0')}`,
          rating: index % 3 ? 8.6 : null,
          is_public: index % 2 === 0,
        });
      }
      for (const sort of ['updated', 'high', 'low'] as const) {
        const first = await storage.getMyVideoReviewPage(prefix, { sort });
        const next = await storage.getMyVideoReviewPage(prefix, {
          sort,
          cursor: first.nextCursor!,
        });
        expect(first.items).toHaveLength(20);
        expect(next.items).toHaveLength(5);
        expect(
          new Set(
            [...first.items, ...next.items].map((item) => item.title_norm),
          ).size,
        ).toBe(25);
        expect(first.counts.private).toBe(12);
        if (sort !== 'updated')
          expect(next.items.every((item) => item.rating === null)).toBe(true);
      }
      const work = await storage.getWorkVideoReviewPage(
        titleNorm,
        '2026',
        prefix,
      );
      const next = await storage.getWorkVideoReviewPage(
        titleNorm,
        '2026',
        prefix,
        work.nextCursor!,
      );
      expect(work.reviews).toHaveLength(20);
      expect(next.reviews).toHaveLength(5);
      expect(work.count).toBe(25);
      expect(
        new Set(
          [...work.reviews, ...next.reviews].map(
            (item) => item.author.profileId,
          ),
        ).size,
      ).toBe(25);
    } finally {
      for (const author of [...authors, prefix])
        await storage.deleteUser(author);
    }
  });

  it('真实 SQL 中个人主页排除直播后续页，库总数包含直播', async () => {
    const username = `public-favorites-${Date.now()}`;
    try {
      for (const [key, origin] of [
        ['source+z', 'live'],
        ['source+e', 'vod'],
        ['source+d', 'live'],
        ['source+c', undefined],
        ['source+b', 'vod'],
        ['source+a', 'live'],
      ] as const) {
        await storage.setFavorite(username, key, {
          ...baseFavorite,
          origin,
          save_time: 1000,
        });
      }
      const query = {
        query: '',
        filter: 'all',
        sort: 'saved',
        limit: 2,
        profileScope: 'public',
      } as const;
      const first = await storage.getFavoriteLibraryPage(username, query);
      const second = await storage.getFavoriteLibraryPage(username, {
        ...query,
        cursor: first.nextCursor,
      });
      expect(first.items.map((item) => item.key)).toEqual([
        'source+e',
        'source+c',
      ]);
      expect(first.total).toBe(3);
      expect(first.nextCursor).toEqual(expect.any(String));
      expect(first.libraryTotal).toBe(6);
      expect(second.items.map((item) => item.key)).toEqual(['source+b']);
      expect(second.nextCursor).toBeNull();
      expect(
        (
          await storage.getFavoriteLibraryPage(username, {
            query: '',
            filter: 'all',
            sort: 'saved',
            limit: 10,
          })
        ).total,
      ).toBe(6);
    } finally {
      await storage.deleteAllFavorites(username);
    }
  });

  it('paginates follows with real SQL predicates', async () => {
    const username = `follow-page-${Date.now()}`;
    try {
      await assertFollowPagination(storage, username);
    } finally {
      await storage.deleteUser(username);
      for (let index = 0; index < 35; index++) {
        await storage.deleteUser(`${username}-${index}`);
      }
    }
  });

  it('reads period sessions with real SQL range and user predicates', async () => {
    await assertPlaybackPeriodRange(storage);
    await assertStatsReuse(storage);
    await assertPlaybackAnnualData(storage);
    await assertAnnualRecapStorage(storage);
    await assertAnnualRecapMessages(storage);
  });

  it('serializes concurrent message-state updates on a missing row', async () => {
    const username = `atomic-read-${Date.now()}`;
    try {
      await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          storage.updateUserMessageState(username, {
            followReview: {
              id: `follow-review:${index}`,
              createdAt: index + 1,
            },
          }),
        ),
      );
      expect(
        (await storage.getUserMessageState(username)).followReviewReadIds,
      ).toHaveLength(12);
      await storage.updateUserMessageState(username, {
        followReviewReadAt: 100,
        announcement: { id: 'announcement:200:new', createdAt: 200 },
        announcementReadAt: 100,
      });
      await Promise.all([
        storage.updateUserMessageState(username, {
          followReview: { id: 'late', createdAt: 1 },
        }),
        storage.updateUserMessageState(username, {
          followReviewReadAt: 50,
          announcement: { id: 'announcement:50:old', createdAt: 50 },
          announcementReadAt: 50,
        }),
      ]);
      expect(await storage.getUserMessageState(username)).toEqual({
        followReviewReadAt: 100,
        followReviewReadIds: [],
        announcementReadAt: 100,
        announcementReadIds: ['announcement:200:new'],
      });
      await storage.updateUserMessageState(username, {
        announcementReadAt: 200,
      });
      expect(await storage.getUserMessageState(username)).toMatchObject({
        announcementReadAt: 200,
        announcementReadIds: [],
      });
    } finally {
      await storage.deleteUser(username);
    }
  });

  it('social SQL enforces profile uniqueness, reactions, moderation and deletion', async () => {
    const suffix = Date.now();
    const author = `social-author-${suffix}`;
    const reader = `social-reader-${suffix}`;
    const title = `social${suffix}`;
    try {
      await storage.registerUser(author, 'test-password');
      await storage.registerUser(reader, 'test-password');
      const profile = await storage.ensureUserProfile(author);
      expect(profile.profile_id).toMatch(/^[A-Za-z0-9]{12}$/);
      const nickname = `N${String(suffix).slice(-12)}`;
      expect(profile.avatar_seed).toBeNull();
      await storage.updateUserProfile(author, { avatarSeed: 'Avatar012345' });
      await storage.updateUserProfile(author, { nickname });
      expect(
        (await storage.getUserProfileById(profile.profile_id))?.avatar_seed,
      ).toBe('Avatar012345');
      await expect(
        storage.updateUserProfile(reader, { nickname: nickname.toLowerCase() }),
      ).rejects.toThrow('昵称已被使用');
      await storage.setUserFollow(reader, author, true);
      await storage.setVideoReview(author, {
        ...videoReview,
        title_norm: title,
        rating: 8.7,
        updated_at: Date.now() + 1000,
      });
      expect(
        await storage.setVideoReviewLike(author, title, '2026', reader, true),
      ).toEqual({ liked: true, likeCount: 1 });
      expect(
        await storage.setVideoReviewLike(author, title, '2026', reader, true),
      ).toEqual({ liked: true, likeCount: 1 });
      expect(
        await storage.reportVideoReview(
          author,
          title,
          '2026',
          reader,
          'spam',
          '',
        ),
      ).toBe(true);
      expect(
        await storage.reportVideoReview(
          author,
          title,
          '2026',
          reader,
          'spoiler',
          'detail',
        ),
      ).toBe(true);
      const reports = await storage.getReviewReportPage();
      expect(
        reports.items.find((item) => item.review.username === author),
      ).toMatchObject({ reportCount: 1, reasons: { spoiler: 1 } });
      const work = await storage.getPublicVideoReviewsForWork(
        title,
        '2026',
        reader,
      );
      expect(work.distribution[7]).toBe(1);
      expect(work.distribution[8]).toBe(0);
      expect(work.reviews[0]).toMatchObject({
        author: { profileId: profile.profile_id, avatarSeed: 'Avatar012345' },
        likedByMe: true,
        likeCount: 1,
      });
      expect(
        await storage.getFollowReviewMessages(reader, 0, [], Date.now() + 2000),
      ).toHaveLength(1);
      await storage.moderateReviewReports(
        author,
        title,
        '2026',
        'mark-spoiler',
      );
      expect(
        (await storage.getVideoReview(author, title, '2026'))?.spoiler,
      ).toBe(true);
      await storage.deleteVideoReview(author, title, '2026');
      expect((await storage.getUserSocialData(reader)).likes).toEqual([]);
      expect((await storage.getUserSocialData(reader)).reports).toEqual([]);
      await storage.deleteUser(author);
      expect((await storage.getUserSocialData(reader)).follows).toEqual([]);
    } finally {
      await storage.deleteUser(author);
      await storage.deleteUser(reader);
    }
  });

  it('review SQL preserves identity, privacy, nullable ratings and literal cursor search', async () => {
    const user = `live-review-${Date.now()}`;
    const title = `review${Date.now()}`;
    const review = { ...videoReview, title_norm: title, title: `${title} %_!` };
    try {
      await storage.setVideoReview(user, { ...review, year: '', rating: null });
      await storage.setVideoReview(user, review);
      await storage.setVideoReview(user, {
        ...review,
        created_at: 3000,
        updated_at: 4000,
      });
      expect(await storage.getVideoReview(user, title, '2026')).toMatchObject({
        year: '2026',
        created_at: 1000,
      });
      expect(await storage.getVideoReview(user, title, '2025')).toMatchObject({
        year: '',
        rating: null,
      });
      expect(
        await storage.getVideoReview(user, title.toUpperCase(), '2026'),
      ).toBeNull();
      expect(
        await storage.getPublicVideoReviewsForWork(title, '2026'),
      ).toMatchObject({ average: 8, count: 1 });
      for (let index = 0; index < 32; index++) {
        await storage.setVideoReview(user, {
          ...review,
          title_norm: `${title}-${index}`,
        });
      }
      const first = await storage.getPublicVideoReviewPage(
        undefined,
        `${title} %_!`,
      );
      expect(first.items).toHaveLength(30);
      const second = await storage.getPublicVideoReviewPage(
        first.nextCursor!,
        `${title} %_!`,
      );
      expect(second.items).toHaveLength(4);
      expect(second.nextCursor).toBeNull();
      expect(
        new Set(
          [...first.items, ...second.items].map((row) =>
            JSON.stringify([row.title_norm, row.year]),
          ),
        ).size,
      ).toBe(34);
      await storage.setVideoReview(user, { ...review, is_public: false });
      await storage.deleteVideoReview(user, title, '2026', true);
      expect(await storage.getVideoReview(user, title, '2026')).toMatchObject({
        is_public: false,
      });
      expect(
        await storage.getPublicVideoReviewsForWork(title, '2026'),
      ).toMatchObject({ average: null, count: 0 });
    } finally {
      await storage.deleteUser(user);
    }
  });

  it('round trips decimal reviews and aggregates decimal ratings as numbers', async () => {
    const user = `live-decimal-${Date.now()}`;
    const otherUser = `${user}-other`;
    const title = `decimal${Date.now()}`;
    const older = { ...videoReview, title_norm: title, rating: 8.6 };
    const newer = {
      ...older,
      title_norm: `${title}-private`,
      rating: 9.1,
      is_public: false,
      updated_at: 3000,
    };
    try {
      await storage.setVideoReview(user, newer);
      await storage.setVideoReview(user, older);
      await storage.setVideoReview(otherUser, { ...older, rating: 8.7 });
      await storage.setVideoReview(user, { ...older, year: '', rating: null });
      await storage.setVideoReview(user, {
        ...older,
        year: '2025',
        rating: 1.1,
        is_public: false,
      });
      expect(await storage.getVideoReview(user, title, '2026')).toEqual(older);
      const ownReviews = await storage.getAllVideoReviews(user);
      expect(ownReviews).toHaveLength(4);
      expect(ownReviews[0]).toEqual(newer);
      expect(ownReviews).toContainEqual(older);
      const summary = await storage.getPublicVideoReviewsForWork(title, '');
      expect(summary.count).toBe(2);
      expect(typeof summary.average).toBe('number');
      expect(summary.average).toBeCloseTo(8.65, 8);
      expect(summary.reviews.map((review) => review.rating)).toEqual(
        expect.arrayContaining([8.6, 8.7, null]),
      );
    } finally {
      await storage.deleteUser(user);
      await storage.deleteUser(otherUser);
    }
  });

  it('只返回未读且未关闭追更的记录', async () => {
    const user = `live-basic-${Date.now()}`;
    await storage.setPlayRecords(user, {
      'source+new': makeRecord(12, 10, 30),
      'source+read': makeRecord(10, 10, 20),
      'source+disabled': makeRecord(20, 10, 40, { tracking_enabled: false }),
      'source+finished': makeRecord(12, 10, 50, { index: 12 }),
    });

    const page = await storage.getUnreadTrackingPlayRecordPage(user, 10);

    expect(page.total).toBe(1);
    expect(Object.keys(page.items)).toEqual(['source+new']);
    expect(page.nextCursor).toBeNull();
  });

  it('按检测时间倒序翻页，total 恒为总未读数', async () => {
    const user = `live-page-${Date.now()}`;
    await storage.setPlayRecords(user, {
      'source+a': makeRecord(12, 10, 10),
      'source+b': makeRecord(12, 10, 20),
      'source+c': makeRecord(12, 10, 30),
    });

    const first = await storage.getUnreadTrackingPlayRecordPage(user, 2);

    expect(first.total).toBe(3);
    expect(Object.keys(first.items)).toEqual(['source+c', 'source+b']);
    expect(first.nextCursor).not.toBeNull();

    const [cursorTime, cursorKey] = (first.nextCursor ?? '').split('|');
    const second = await storage.getUnreadTrackingPlayRecordPage(
      user,
      2,
      Number(cursorTime),
      cursorKey,
    );

    expect(second.total).toBe(3);
    expect(Object.keys(second.items)).toEqual(['source+a']);
    expect(second.nextCursor).toBeNull();
  });

  it('按分组刻度判定未读', async () => {
    const user = `live-group-${Date.now()}`;
    await storage.setPlayRecords(user, {
      'source+group-new': makeRecord(0, 0, 30, {
        group_index: 1,
        group_total: 4,
        update_baseline_group_total: 2,
        total_episodes: 99,
        update_baseline_episodes: 99,
      }),
      'source+group-read': makeRecord(0, 0, 20, {
        group_index: 2,
        group_total: 2,
        update_baseline_group_total: 2,
        total_episodes: 99,
        update_baseline_episodes: 1,
      }),
    });

    const page = await storage.getUnreadTrackingPlayRecordPage(user, 10);

    expect(page.total).toBe(1);
    expect(Object.keys(page.items)).toEqual(['source+group-new']);
  });

  it('缺字段与非数字字段不报错且不误判为未读', async () => {
    const user = `live-loose-${Date.now()}`;
    await storage.setPlayRecords(user, {
      'source+missing-baseline': {
        ...basePlayRecord,
        save_time: 10,
        total_episodes: 12,
        index: 1,
      },
      'source+null-total': {
        ...basePlayRecord,
        save_time: 20,
        index: 1,
        total_episodes: null as unknown as number,
      },
      'source+string-total': {
        ...basePlayRecord,
        save_time: 30,
        index: 1,
        total_episodes: 'abc' as unknown as number,
        update_baseline_episodes: 1,
      },
    });

    const page = await storage.getUnreadTrackingPlayRecordPage(user, 10);

    expect(page.total).toBe(0);
    expect(Object.keys(page.items)).toEqual([]);
  });

  it('tracking_enabled 缺失时按开启处理', async () => {
    const user = `live-default-${Date.now()}`;
    const record = makeRecord(12, 10, 30);
    delete record.tracking_enabled;
    await storage.setPlayRecords(user, { 'source+no-flag': record });

    const page = await storage.getUnreadTrackingPlayRecordPage(user, 10);

    expect(page.total).toBe(1);
    expect(Object.keys(page.items)).toEqual(['source+no-flag']);
  });

  it('元数据分页按真实毫秒时间戳识别 TTL', async () => {
    const user = `live-metadata-${Date.now()}`;
    const now = Date.now();
    const ttlMs = 6 * 60 * 60 * 1000;
    await storage.setPlayRecords(user, {
      'source+fresh': {
        ...basePlayRecord,
        metadata_checked_at: now - 1_000,
      },
      'source+stale': {
        ...basePlayRecord,
        metadata_checked_at: now - ttlMs,
      },
    });
    await storage.setFavorite(user, 'source+fresh', {
      ...baseFavorite,
      metadata_checked_at: now - 1_000,
    });
    await storage.setFavorite(user, 'source+stale', {
      ...baseFavorite,
      metadata_checked_at: now - ttlMs,
    });

    const recordPage = await storage.getStalePlayRecordPage(
      user,
      now,
      ttlMs,
      10,
    );
    const favoritePage = await storage.getStaleFavoritePage(
      user,
      now,
      ttlMs,
      10,
    );

    expect(recordPage.items.map(({ key }) => key)).toEqual(['source+stale']);
    expect(favoritePage.items.map(({ key }) => key)).toEqual(['source+stale']);
  });

  it('元数据 CAS 使用原始 JSON 二进制比较', async () => {
    const user = `live-cas-${Date.now()}`;
    const staleRecord: PlayRecord = {
      ...basePlayRecord,
      title: 'Demo',
      metadata_checked_at: 1,
    };
    const staleFavorite: Favorite = {
      ...baseFavorite,
      title: 'Demo',
      metadata_checked_at: 1,
    };

    await storage.setPlayRecord(user, 'source+record', staleRecord);
    await storage.setFavorite(user, 'source+favorite', staleFavorite);

    const recordPage = await storage.getStalePlayRecordPage(
      user,
      Date.now(),
      1_000,
      10,
    );
    const favoritePage = await storage.getStaleFavoritePage(
      user,
      Date.now(),
      1_000,
      10,
    );
    const recordSnapshot = recordPage.items[0]?.snapshot;
    const favoriteSnapshot = favoritePage.items[0]?.snapshot;
    expect(recordSnapshot).toBe(JSON.stringify(staleRecord));
    expect(favoriteSnapshot).toBe(JSON.stringify(staleFavorite));

    await expect(
      storage.setPlayRecordIfUnchanged(
        user,
        'source+record',
        { ...staleRecord, metadata_checked_at: Date.now() },
        recordSnapshot as string,
      ),
    ).resolves.toBe(true);
    await expect(
      storage.setFavoriteIfUnchanged(
        user,
        'source+favorite',
        { ...staleFavorite, metadata_checked_at: Date.now() },
        favoriteSnapshot as string,
      ),
    ).resolves.toBe(true);

    // 仅大小写变化也必须被 CAS 识别为并发修改，避免受连接排序规则影响。
    await storage.setPlayRecord(user, 'source+record', {
      ...staleRecord,
      title: 'demo',
    });
    await storage.setFavorite(user, 'source+favorite', {
      ...staleFavorite,
      title: 'demo',
    });

    await expect(
      storage.setPlayRecordIfUnchanged(
        user,
        'source+record',
        { ...staleRecord, title: 'cron 覆盖' },
        recordSnapshot as string,
      ),
    ).resolves.toBe(false);
    await expect(
      storage.setFavoriteIfUnchanged(
        user,
        'source+favorite',
        { ...staleFavorite, title: 'cron 覆盖' },
        favoriteSnapshot as string,
      ),
    ).resolves.toBe(false);
  });
});

describeLive('MySQL user danmaku contract (real instance)', () => {
  const stores: MySqlStorage[] = [];
  userDanmakuContract(() => {
    const storage = new MySqlStorage(liveUrl);
    stores.push(storage);
    return storage;
  }, resetMysqlTestData);
  afterAll(async () => {
    for (const storage of stores)
      await (
        storage as unknown as { pool: import('mysql2/promise').Pool }
      ).pool.end();
  });
});

describeLive('MySQL OAuth 身份契约（真实实例）', () => {
  const stores: MySqlStorage[] = [];
  oauthIdentityContract(() => {
    const storage = new MySqlStorage(liveUrl);
    stores.push(storage);
    return storage;
  }, resetMysqlTestData);
  afterAll(async () => {
    for (const storage of stores)
      await (
        storage as unknown as { pool: import('mysql2/promise').Pool }
      ).pool.end();
  });
});

describeLive('MySQL 片单契约（真实实例）', () => {
  const stores: MySqlStorage[] = [];
  listsContract(() => {
    const storage = new MySqlStorage(liveUrl);
    stores.push(storage);
    return storage;
  }, resetMysqlTestData);
  afterAll(async () => {
    for (const storage of stores)
      await (
        storage as unknown as { pool: import('mysql2/promise').Pool }
      ).pool.end();
  });
});

describeLive('MySQL 片单并发（真实实例）', () => {
  let storage: MySqlStorage;
  beforeAll(async () => {
    storage = new MySqlStorage(liveUrl);
    await resetMysqlTestData(storage);
    await storage.ensureUserProfile('lists-owner');
  });
  afterAll(async () => {
    await resetMysqlTestData(storage);
    await (
      storage as unknown as { pool: import('mysql2/promise').Pool }
    ).pool.end();
  });
  it('并发创建守住上限，重复添加幂等，旧版本排序失败', async () => {
    for (let i = 0; i < 49; i++)
      await storage.createList('lists-owner', { name: '片单' });
    const created = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        storage.createList('lists-owner', { name: '并发' }),
      ),
    );
    expect(
      created.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await storage.countUserLists('lists-owner')).toBe(50);
    const list = (await storage.getLists('lists-owner', 'lists-owner'))[0];
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        storage.addListItem('lists-owner', list.id, {
          title: '作品',
          year: '',
          cover: '',
          source: '',
          id: null,
        }),
      ),
    );
    expect(new Set(results.map((result) => result.item.id)).size).toBe(1);
    expect(new Set(results.map((result) => result.list.version)).size).toBe(1);
    const sorted = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        storage.reorderListItems(
          'lists-owner',
          list.id,
          [results[0].item.id],
          results[0].list.version,
        ),
      ),
    );
    expect(
      sorted.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(sorted.find((result) => result.status === 'rejected')).toMatchObject(
      { reason: { code: 'LIST_VERSION_CONFLICT' } },
    );
  });
  it('并发点赞幂等，删号重算计数，删片单清除点赞行', async () => {
    const pool = (storage as unknown as { pool: import('mysql2/promise').Pool })
      .pool;
    await storage.ensureUserProfile('likes-owner');
    const list = await storage.createList('likes-owner', {
      name: '点赞并发',
      visibility: 'everyone',
    });
    await storage.ensureUserProfile('lists-liker');
    const before = (await storage.getList(list.id, 'lists-owner')).list;
    const liked = await Promise.all(
      Array.from({ length: 4 }, () =>
        storage.setListLike('lists-liker', list.id, true),
      ),
    );
    expect(liked).toEqual(
      Array.from({ length: 4 }, () => ({ liked: true, likeCount: 1 })),
    );
    expect((await storage.getList(list.id, 'lists-owner')).list).toEqual({
      ...before,
      likeCount: 1,
    });
    await storage.deleteUser('lists-liker');
    expect((await storage.getList(list.id, 'lists-owner')).list.likeCount).toBe(
      0,
    );
    await storage.ensureUserProfile('lists-liker');
    await storage.setListLike('lists-liker', list.id, true);
    await storage.deleteList('likes-owner', list.id);
    const [rows] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM list_likes WHERE list_id = ?',
      [list.id],
    );
    expect(Number(rows[0].total)).toBe(0);
  });
});

describeLive('MySQL 追剧周历契约（真实实例）', () => {
  let storage: MySqlStorage;
  beforeAll(async () => {
    storage = new MySqlStorage(liveUrl);
    await resetMysqlTestData(storage);
  });
  afterAll(async () => {
    await resetMysqlTestData(storage);
    await (
      storage as unknown as { pool: import('mysql2/promise').Pool }
    ).pool.end();
  });
  it('候选范围、隔离、去重、集刻度与上限', async () => {
    await assertTrackingCalendar(storage);
  }, 30_000);
});
