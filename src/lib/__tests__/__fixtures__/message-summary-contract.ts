import { emptyAnnualActivity } from '@/features/playback-stats/lib/annual-activity';
import { aggregateAnnualReport } from '@/features/playback-stats/lib/annual-report';
import { publicAnnualReport } from '@/features/playback-stats/lib/annual-share';
import { videoReview } from '@/lib/__tests__/__fixtures__/video-review-contract';
import type { MessageSummarySource } from '@/lib/message-source-summary';
import type { UserMessage } from '@/lib/message-types';
import type { IStorage } from '@/lib/types';

export async function assertMessageSummaries(storage: IStorage) {
  const owner = 'summary-owner';
  const author = 'summary-author';
  const other = 'summary-other';
  const clock = jest.spyOn(Date, 'now').mockReturnValue(9000);
  try {
    for (const user of [owner, author, other])
      await storage.registerUser(user, 'unused-password');
    await storage.setUserFollow(owner, author, true);
    await storage.setUserFollow(author, owner, true);
    await storage.setUserFollow(other, owner, true);
    clock.mockReturnValue(10000);
    for (const user of [owner, author]) {
      for (const year of ['2025', '2026'])
        await storage.setVideoReview(user, {
          ...videoReview,
          year,
          updated_at: 10000,
        });
    }
    for (const year of ['2025', '2026']) {
      await storage.setVideoReviewLike(
        owner,
        videoReview.title_norm,
        year,
        author,
        true,
      );
      await storage.postReviewReply(
        owner,
        videoReview.title_norm,
        year,
        author,
        'reply',
      );
      const report = publicAnnualReport(
        aggregateAnnualReport({
          year: Number(year),
          timeZone: 'UTC',
          now: 10000,
          data: { sessions: [], buckets: [], earliestStartedAt: null },
          reviews: [],
          retentionDays: 0,
        }),
        [],
        true,
        emptyAnnualActivity(),
      );
      await storage.saveAnnualRecap(author, report, 10000);
    }
    await storage.updateUserAccess([owner], { role: 'admin' });
    const sources: MessageSummarySource[] = [
      'follow-review',
      'follow-recap',
      'review-reply',
      'new-follower',
      'review-like',
      'user-notice',
    ];
    for (const kind of sources) {
      const list = (readAt: number, ids: string[]): Promise<UserMessage[]> => {
        const args = [owner, readAt, ids, 10000, { limit: 201 }] as const;
        if (kind === 'follow-review')
          return storage.getFollowReviewMessages(...args);
        if (kind === 'follow-recap')
          return storage.getFollowRecapMessages(...args);
        if (kind === 'review-reply')
          return storage.getReviewReplyMessages(...args);
        if (kind === 'user-notice')
          return storage.getUserNoticeMessages(...args);
        return storage.getSocialNotifications(kind, ...args);
      };
      const all = await list(0, []);
      expect(all.length).toBeGreaterThan(0);
      for (const [readAt, ids] of [
        [0, []],
        [0, [all[0].id]],
        [all[0].createdAt, []],
      ] as [number, string[]][]) {
        const remaining = await list(readAt, ids);
        expect(
          await storage.getMessageSourceSummary(
            kind,
            owner.toUpperCase(),
            readAt,
            ids,
            10000,
          ),
        ).toEqual({ items: remaining.slice(0, 1), total: remaining.length });
      }
      expect(
        await storage.getMessageSourceSummary(
          kind,
          'summary-missing',
          0,
          [],
          10000,
        ),
      ).toEqual({ items: [], total: 0 });
    }
    await storage.setVideoReview(owner, {
      ...videoReview,
      year: '2026',
      is_public: false,
    });
    const likes = await storage.getMessageSourceSummary(
      'review-like',
      owner,
      0,
      [],
      10000,
    );
    expect(likes.total).toBe(1);
    await storage.setUserFollow(owner, author, false);
    expect(
      (
        await storage.getMessageSourceSummary(
          'follow-review',
          owner,
          0,
          [],
          10000,
        )
      ).total,
    ).toBe(0);
  } finally {
    clock.mockRestore();
    for (const user of [owner, author, other]) await storage.deleteUser(user);
  }
}
