/** @jest-environment node */
import type Database from 'better-sqlite3';

import {
  getUserMessageSummary,
  invalidateMessageAnnouncementSnapshot,
} from '@/lib/messages.server';
import { LocalSqliteStorage } from '@/lib/sqlite.db';

let mockStorage: LocalSqliteStorage;
jest.mock('@/lib/db', () => ({
  db: new Proxy(
    {},
    {
      get:
        (_target, key) =>
        (...args: unknown[]) =>
          Reflect.apply(Reflect.get(mockStorage, key), mockStorage, args),
    },
  ),
}));

const benchmark = process.env.RUN_MESSAGE_BASELINE === '1' ? it : it.skip;
benchmark(
  'measures message sources on isolated 4000-user SQLite data',
  async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const raw = (storage as unknown as { db: Database.Database }).db;
    const now = Date.UTC(2026, 10, 26);
    const user = 'bench-0';
    mockStorage = storage;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const profile = raw.prepare(
        'INSERT INTO user_profiles (username, profile_id, updated_at) VALUES (?, ?, ?)',
      );
      const play = raw.prepare(
        'INSERT INTO play_records (username, record_key, record_json) VALUES (?, ?, ?)',
      );
      const review = raw.prepare(
        'INSERT INTO video_reviews (username, title_norm, year, review_json, is_public, updated_at, first_published_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      );
      const follow = raw.prepare(
        'INSERT INTO user_follows (follower, followee, created_at) VALUES (?, ?, ?)',
      );
      const notice = raw.prepare(
        "INSERT INTO user_notice_events (id, recipient_username, event_key, kind, action, payload_json, created_at) VALUES (?, ?, ?, 'account-change', 'permissions-changed', '{}', ?)",
      );
      const like = raw.prepare(
        "INSERT INTO video_review_likes (author, title_norm, year, liker, created_at) VALUES (?, 'work-0', '2026', ?, ?)",
      );
      const reply = raw.prepare(
        "INSERT INTO video_review_replies (id, author, title_norm, year, username, content, created_at) VALUES (?, ?, 'work-0', '2026', ?, 'test', ?)",
      );
      raw.transaction(() => {
        for (let i = 0; i < 4000; i++) {
          const username = `bench-${i}`;
          profile.run(username, `profile-${i}`, now);
          for (let j = 0; j < 20; j++)
            play.run(
              username,
              `source+${j}`,
              JSON.stringify({
                title: `Work ${j}`,
                year: '2026',
                index: 1,
                total_episodes: 20,
                update_baseline_episodes: 10,
                save_time: now - j,
                update_detected_at: now - j,
              }),
            );
          for (let j = 0; j < 5; j++) {
            review.run(
              username,
              `work-${j}`,
              '2026',
              JSON.stringify({
                title: `Work ${j}`,
                title_norm: `work-${j}`,
                year: '2026',
                rating: 4,
                cover: '',
              }),
              now - j,
              now - j,
            );
            follow.run(username, `bench-${(i + j + 1) % 4000}`, now - 10000);
            notice.run(`${i}-${j}`, username, `${i}-${j}`, now - j);
            like.run(username, `bench-${(i + j + 1) % 4000}`, now - j);
            reply.run(
              `${i}-${j}`,
              username,
              `bench-${(i + j + 1) % 4000}`,
              now - j,
            );
          }
        }
      })();
      const args: [string, number, string[], number] = [user, 0, [], now];
      const cases: Record<string, () => Promise<unknown>> = {
        tracking: () => storage.getUnreadTrackingPlayRecordPage(user, 1),
        favorites: () => storage.getFavoriteUpdateMessagePage(user, 1),
        follow: () =>
          Promise.all([
            storage.getFollowReviewMessages(...args, { limit: 1 }),
            storage.getFollowReviewMessageCount(...args),
          ]),
        recap: () =>
          Promise.all([
            storage.getFollowRecapMessages(...args, { limit: 1 }),
            storage.getFollowRecapMessageCount(...args),
          ]),
        reply: () =>
          Promise.all([
            storage.getReviewReplyMessages(...args, { limit: 1 }),
            storage.getReviewReplyMessageCount(...args),
          ]),
        follower: () =>
          Promise.all([
            storage.getSocialNotifications('new-follower', ...args, {
              limit: 1,
            }),
            storage.getSocialNotificationCount('new-follower', ...args),
          ]),
        like: () =>
          Promise.all([
            storage.getSocialNotifications('review-like', ...args, {
              limit: 1,
            }),
            storage.getSocialNotificationCount('review-like', ...args),
          ]),
        notice: () =>
          Promise.all([
            storage.getUserNoticeMessages(...args, { limit: 1 }),
            storage.getUserNoticeCount(...args),
          ]),
        capsule: () => storage.getCapsuleMessages(user, 1, undefined, now),
        state: () => storage.getUserMessageState(user),
        announcement: () =>
          storage.getPublishedAnnouncements({
            since: now - 30 * 86400000,
            limit: 50,
          }),
      };
      for (const kind of [
        'follow-review',
        'follow-recap',
        'review-reply',
        'new-follower',
        'review-like',
        'user-notice',
      ] as const) {
        cases[`summary-${kind}`] = () =>
          storage.getMessageSourceSummary(kind, ...args);
      }
      const metrics: Record<string, number> = {};
      for (const [name, run] of Object.entries(cases)) {
        const times: number[] = [];
        for (let round = 0; round < 6; round++) {
          const start = performance.now();
          await run();
          if (round) times.push(performance.now() - start);
        }
        metrics[name] = Number(times.sort((a, b) => a - b)[2].toFixed(3));
      }
      console.warn('message-summary-baseline', JSON.stringify(metrics));
      const prepare = raw.prepare.bind(raw);
      let sqlCount = 0;
      const spy = jest
        .spyOn(raw, 'prepare')
        .mockImplementation((sql: string) => {
          sqlCount++;
          return prepare(sql);
        });
      const stmts = (
        storage as unknown as { stmts: Record<string, Database.Statement> }
      ).stmts;
      const statementSpies = Object.values(stmts).flatMap((stmt) =>
        (['all', 'get'] as const).map((method) => {
          const original = stmt[method].bind(stmt);
          return jest
            .spyOn(stmt, method)
            .mockImplementation((...params: unknown[]) => {
              sqlCount++;
              return original(...params);
            });
        }),
      );
      const summaryTimes: number[] = [];
      const summaryCounts: number[] = [];
      invalidateMessageAnnouncementSnapshot();
      for (let round = 0; round < 6; round++) {
        sqlCount = 0;
        const start = performance.now();
        await getUserMessageSummary(user);
        const elapsed = performance.now() - start;
        summaryCounts.push(sqlCount);
        if (round) summaryTimes.push(elapsed);
      }
      spy.mockRestore();
      statementSpies.forEach((item) => item.mockRestore());
      console.warn(
        'message-full-summary',
        JSON.stringify({
          sqlCounts: summaryCounts,
          medianMs: summaryTimes.sort((a, b) => a - b)[2],
        }),
      );
    } finally {
      clock.mockRestore();
      raw.close();
    }
  },
  60000,
);
