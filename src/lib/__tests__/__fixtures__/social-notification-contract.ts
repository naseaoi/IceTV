import { videoReview } from '@/lib/__tests__/__fixtures__/video-review-contract';
import { messageSortKey } from '@/lib/message-cursor.server';
import type { IStorage } from '@/lib/types';

export async function assertSocialNotifications(
  storage: IStorage,
  prefix: string,
) {
  const author = `${prefix}-author`,
    a = `${prefix}-a`,
    b = `${prefix}-b`;
  for (const username of [author, a, b])
    await storage.ensureUserProfile(username);
  const clock = jest.spyOn(Date, 'now').mockReturnValue(10000);
  try {
    await storage.setUserFollow(a, author, true);
    await storage.setUserFollow(b, author, true);
    const followers = await storage.getSocialNotifications(
      'new-follower',
      author,
      0,
      [],
      10000,
    );
    expect(followers).toHaveLength(2);
    expect(
      await storage.getSocialNotificationCount('new-follower', a, 0, [], 10000),
    ).toBe(0);
    expect(
      await storage.getSocialNotificationCount(
        'new-follower',
        author,
        0,
        [followers[0].id],
        10000,
      ),
    ).toBe(1);
    const first = await storage.getSocialNotifications(
      'new-follower',
      author,
      0,
      [],
      10000,
      { limit: 1 },
    );
    const next = await storage.getSocialNotifications(
      'new-follower',
      author,
      0,
      [],
      10000,
      {
        before: {
          createdAt: first[0].createdAt,
          key: messageSortKey(first[0]),
        },
      },
    );
    expect(next).toHaveLength(1);
    expect(next[0].id).not.toBe(first[0].id);
    await storage.setUserFollow(a, author, false);
    expect(
      await storage.getSocialNotificationCount(
        'new-follower',
        author,
        0,
        [],
        10000,
      ),
    ).toBe(1);
    expect(
      await storage.getSocialNotificationCount(
        'new-follower',
        author,
        0,
        [],
        31 * 86400000,
      ),
    ).toBe(0);
    await expect(storage.setUserFollow(author, author, true)).rejects.toThrow();
    await storage.setVideoReview(author, videoReview);
    const target = [author, videoReview.title_norm, videoReview.year] as const;
    await storage.setVideoReviewLike(...target, a, true);
    await expect(
      storage.setVideoReviewLike(...target, author, true),
    ).rejects.toThrow();
    const likes = await storage.getSocialNotifications(
      'review-like',
      author,
      0,
      [],
      10000,
    );
    expect(likes).toHaveLength(1);
    expect(likes[0]).toMatchObject({
      type: 'review-like',
      likeCount: 1,
      review: { title_norm: videoReview.title_norm },
    });
    expect(
      await storage.getSocialNotificationCount(
        'review-like',
        author,
        0,
        [likes[0].id],
        10000,
      ),
    ).toBe(0);
    clock.mockReturnValue(10001);
    await storage.setVideoReviewLike(...target, b, true);
    const newer = await storage.getSocialNotifications(
      'review-like',
      author,
      0,
      [likes[0].id],
      10001,
    );
    expect(newer).toHaveLength(1);
    expect(newer[0]).toMatchObject({
      likeCount: 2,
      latestLiker: { profileId: (await storage.getUserProfile(b))!.profile_id },
    });
    expect(newer[0].id).not.toBe(likes[0].id);
    await storage.setVideoReviewLike(...target, a, false);
    await storage.setVideoReviewLike(...target, a, true);
    expect(
      await storage.getSocialNotificationCount(
        'review-like',
        author,
        0,
        [],
        10001,
      ),
    ).toBe(1);
    const profileId = (await storage.getUserProfile(author))!.profile_id;
    expect(
      await storage.getPublicReview(
        {
          profileId,
          title_norm: videoReview.title_norm,
          year: videoReview.year,
        },
        a,
      ),
    ).toMatchObject({ likedByMe: true, likeCount: 2, replyCount: 0 });
    await storage.setVideoReview(author, { ...videoReview, is_public: false });
    expect(
      await storage.getSocialNotificationCount(
        'review-like',
        author,
        0,
        [],
        10001,
      ),
    ).toBe(0);
    expect(
      await storage.getPublicReview(
        {
          profileId,
          title_norm: videoReview.title_norm,
          year: videoReview.year,
        },
        author,
      ),
    ).toBeNull();
    await storage.updateUserMessageState(author, {
      notificationSettings: {
        mutedKinds: ['new-follower', 'review-like'],
        now: 10002,
      },
    });
    await storage.updateUserMessageState(author, {
      newFollower: { id: followers[0].id, createdAt: followers[0].createdAt },
    });
    const reopened = await storage.updateUserMessageState(author, {
      notificationSettings: { mutedKinds: [], now: 10003 },
    });
    expect(reopened).toMatchObject({
      mutedKinds: [],
      newFollowerReadAt: 10003,
      reviewLikeReadAt: 10003,
    });
    expect(
      await storage.getSocialNotificationCount(
        'new-follower',
        author,
        reopened.newFollowerReadAt!,
        [],
        10003,
      ),
    ).toBe(0);
  } finally {
    clock.mockRestore();
  }
}
