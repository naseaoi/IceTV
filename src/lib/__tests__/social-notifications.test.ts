/** @jest-environment node */

import { assertSocialNotifications } from '@/lib/__tests__/__fixtures__/social-notification-contract';
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
