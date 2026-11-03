import type { AdminConfig } from '@/types/admin';

import type { IStorage, VideoReview } from '../../types';

export const videoReview: VideoReview = {
  title_norm: 'reviewdemo',
  year: '2026',
  title: 'Review Demo',
  cover: '',
  douban_id: 0,
  rating: 8,
  content: 'Good',
  is_public: true,
  source_key: 'source+1',
  created_at: 1000,
  updated_at: 2000,
};

export function videoReviewContract(
  createStorage: () => IStorage,
  adminConfig: AdminConfig,
) {
  it('matches exact years, falls back to unknown, and preserves creation time', async () => {
    const storage = createStorage();
    await storage.clearAllData();
    await storage.setVideoReview('review-user', {
      ...videoReview,
      year: '',
      updated_at: 9000,
    });
    await storage.setVideoReview('review-user', videoReview);
    expect(
      (await storage.getVideoReview('Review-User', 'reviewdemo', '2026'))?.year,
    ).toBe('2026');
    expect(
      (await storage.getVideoReview('review-user', 'reviewdemo', '2025'))?.year,
    ).toBe('');
    expect(
      (await storage.getVideoReview('review-user', 'reviewdemo', ''))
        ?.updated_at,
    ).toBe(9000);
    await storage.setVideoReview('review-user', {
      ...videoReview,
      created_at: 3000,
      updated_at: 4000,
    });
    expect(
      (await storage.getVideoReview('review-user', 'reviewdemo', '2026'))
        ?.created_at,
    ).toBe(1000);
    expect(
      await storage.getVideoReview('review-user', 'ReviewDemo', '2026'),
    ).toBeNull();
    expect(await storage.getAllVideoReviews('review-user')).toHaveLength(2);
    await storage.deleteVideoReview('review-user', 'reviewdemo', '2026');
    expect(
      (await storage.getVideoReview('review-user', 'reviewdemo', '2026'))?.year,
    ).toBe('');
    await storage.deleteUser('review-user');
    expect(await storage.getAllVideoReviews('review-user')).toEqual([]);
  });

  it('round trips decimal ratings and returns an unrounded numeric average', async () => {
    const storage = createStorage();
    await storage.clearAllData();
    const older = { ...videoReview, rating: 8.6 };
    const newer = {
      ...videoReview,
      title_norm: 'privatework',
      rating: 9.1,
      is_public: false,
      updated_at: 3000,
    };
    await storage.setVideoReview('review-user', newer);
    await storage.setVideoReview('review-user', older);
    await storage.setVideoReview('other-user', { ...videoReview, rating: 8.7 });
    await storage.setVideoReview('text-only', { ...videoReview, rating: null });
    await storage.setVideoReview('private-user', {
      ...videoReview,
      rating: 1.1,
      is_public: false,
    });
    expect(
      await storage.getVideoReview('review-user', 'reviewdemo', '2026'),
    ).toEqual(older);
    expect(await storage.getAllVideoReviews('Review-User')).toEqual([
      newer,
      older,
    ]);
    const summary = await storage.getPublicVideoReviewsForWork(
      'reviewdemo',
      '2026',
    );
    expect(summary.count).toBe(2);
    expect(typeof summary.average).toBe('number');
    expect(summary.average).toBeCloseTo(8.65, 8);
    expect(summary.reviews.map((review) => review.rating)).toEqual(
      expect.arrayContaining([8.6, 8.7, null]),
    );
  });

  it('isolates private reviews and aggregates all rated matches beyond the public list limit', async () => {
    const storage = createStorage();
    await storage.clearAllData();
    for (let index = 0; index < 52; index++) {
      await storage.setVideoReview(`review-${index}`, {
        ...videoReview,
        rating: 6,
        updated_at: 2000 + index,
      });
    }
    await storage.setVideoReview('unknown', {
      ...videoReview,
      year: '',
      rating: 10,
    });
    await storage.setVideoReview('other-year', {
      ...videoReview,
      year: '2024',
      rating: 2,
    });
    await storage.setVideoReview('private', {
      ...videoReview,
      rating: 1,
      is_public: false,
    });
    await storage.setVideoReview('text-only', { ...videoReview, rating: null });
    const summary = await storage.getPublicVideoReviewsForWork(
      'reviewdemo',
      '2026',
    );
    expect(summary.count).toBe(53);
    expect(summary.average).toBeCloseTo((52 * 6 + 10) / 53, 4);
    expect(summary.reviews).toHaveLength(50);
    expect(summary.reviews.some((row) => row.username === 'private')).toBe(
      false,
    );
    expect(summary.reviews[0]).not.toHaveProperty('source_key');
    expect(
      (await storage.getPublicVideoReviewsForWork('reviewdemo', '')).count,
    ).toBe(54);
    expect(await storage.getPublicVideoReviewsForWork('missing', '')).toEqual({
      average: null,
      count: 0,
      reviews: [],
    });
    await storage.deleteVideoReview('private', 'reviewdemo', '2026', true);
    expect(await storage.getAllVideoReviews('private')).toHaveLength(1);
  });

  it('paginates timestamp ties without duplicates and treats LIKE wildcards literally', async () => {
    const storage = createStorage();
    await storage.clearAllData();
    for (let index = 0; index < 35; index++) {
      await storage.setVideoReview('review-user', {
        ...videoReview,
        title: `Literal %_! ${index}`,
        title_norm: `literal${index}`,
      });
    }
    await storage.setVideoReview('private', {
      ...videoReview,
      is_public: false,
    });
    const first = await storage.getPublicVideoReviewPage(undefined, '%_!');
    expect(first.items).toHaveLength(30);
    expect(first.nextCursor).not.toBeNull();
    const second = await storage.getPublicVideoReviewPage(
      first.nextCursor!,
      '%_!',
    );
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((row) => row.title_norm))
        .size,
    ).toBe(35);
    expect(
      (await storage.getPublicVideoReviewPage(undefined, 'REVIEW-USER')).items,
    ).toHaveLength(30);
    await expect(storage.getPublicVideoReviewPage('broken')).rejects.toThrow(
      '分页游标无效',
    );
  });

  it('round trips reviews and clears them on replacement and full cleanup', async () => {
    const storage = createStorage();
    await storage.clearAllData();
    await storage.setVideoReview('review-user', videoReview);
    const videoReviews = await storage.getAllVideoReviews('review-user');
    const snapshot = {
      adminConfig,
      users: {},
      sourceRouteStats: [],
      inviteCodeUsage: {},
      userData: {
        'review-user': {
          playRecords: {},
          favorites: {},
          searchHistory: [],
          skipConfigs: {},
          playbackSessions: {},
          videoReviews,
        },
      },
    };
    await storage.replaceAllData(snapshot);
    expect(await storage.getAllVideoReviews('review-user')).toEqual([
      videoReview,
    ]);
    await storage.replaceAllData({ ...snapshot, userData: {} });
    expect(await storage.getAllVideoReviews('review-user')).toEqual([]);
    await storage.setVideoReview('review-user', videoReview);
    await storage.clearAllData();
    expect(await storage.getAllVideoReviews('review-user')).toEqual([]);
  });
}
