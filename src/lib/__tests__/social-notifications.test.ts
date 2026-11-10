/** @jest-environment node */

import { assertSocialNotifications } from '@/lib/__tests__/__fixtures__/social-notification-contract';
import { videoReview } from '@/lib/__tests__/__fixtures__/video-review-contract';
import { socialNotificationId } from '@/lib/social-notification-identity';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import { mergeUserMessageState } from '@/lib/user-message-state';

it('SQLite 新粉丝与合并点赞、已读、单条公开评价契约', async () => {
  await assertSocialNotifications(
    new LocalSqliteStorage(':memory:'),
    'notification',
  );
});
it.each(['new-follower', 'review-like'] as const)(
  '%s 的有界已读集合与并发重新开启水位',
  (kind) => {
    const field = kind === 'new-follower' ? 'newFollower' : 'reviewLike';
    const id = (time: number) =>
      socialNotificationId(kind, [
        'Author000001',
        kind === 'review-like' ? '作品' : '',
        '',
        time,
      ]);
    const state = mergeUserMessageState(
      { [`${field}ReadIds`]: Array.from({ length: 200 }, (_, i) => id(i + 1)) },
      { [field]: { id: id(201), createdAt: 201 } },
    );
    expect(state[`${field}ReadAt`]).toBe(1);
    expect(state[`${field}ReadIds`]).toHaveLength(200);
    const muted = mergeUserMessageState(state, {
      notificationSettings: { mutedKinds: [kind], now: 100 },
    });
    const reopened = mergeUserMessageState(muted, {
      notificationSettings: { mutedKinds: [], now: 200 },
    });
    expect(reopened[`${field}ReadIds`]).toEqual([id(201)]);
    expect(reopened[`${field}ReadAt`]).toBe(200);
  },
);

it('首次公开迁移原子回填旧时间，私密旧记录恢复公开不回灌，完成后不补写新草稿', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  const impl = storage as unknown as {
    db: import('better-sqlite3').Database;
    migrateReviewFirstPublished(): void;
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
      title_norm: 'private-old',
      is_public: false,
    });
    impl.db.exec(
      "UPDATE video_reviews SET first_published_at = NULL; DELETE FROM storage_migrations WHERE name = 'review_first_published_v1'",
    );
    impl.db.exec(
      "CREATE TRIGGER fail_review_migration BEFORE INSERT ON storage_migrations BEGIN SELECT RAISE(ABORT, 'interrupt'); END",
    );
    expect(() => impl.migrateReviewFirstPublished()).toThrow('interrupt');
    expect(
      impl.db.prepare('SELECT first_published_at FROM video_reviews').all(),
    ).toEqual([{ first_published_at: null }, { first_published_at: null }]);
    impl.db.exec('DROP TRIGGER fail_review_migration');
    impl.migrateReviewFirstPublished();
    expect(
      await storage.getFollowReviewMessages('reader', 0, [before.id], 3000),
    ).toEqual([]);
    await storage.setVideoReview('author', {
      ...videoReview,
      title_norm: 'private-old',
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
    impl.migrateReviewFirstPublished();
    expect(
      impl.db
        .prepare(
          "SELECT first_published_at FROM video_reviews WHERE title_norm = 'new-draft'",
        )
        .get(),
    ).toEqual({ first_published_at: null });
  } finally {
    clock.mockRestore();
  }
});
