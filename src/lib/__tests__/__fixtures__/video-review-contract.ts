import { followReviewSortKey } from '@/lib/follow-review-identity';

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
  spoiler: false,
  source_key: 'source+1',
  created_at: 1000,
  updated_at: 2000,
};

export async function assertFollowPagination(
  storage: IStorage,
  username: string,
) {
  const profileIds: string[] = [];
  await storage.ensureUserProfile(username);
  const clock = jest.spyOn(Date, 'now').mockReturnValue(5000);
  try {
    for (let index = 0; index < 35; index++) {
      const peer = `${username}-${index}`;
      profileIds.push((await storage.ensureUserProfile(peer)).profile_id);
      await storage.setUserFollow(username, peer, true);
      await storage.setUserFollow(peer, username, true);
    }
  } finally {
    clock.mockRestore();
  }
  const expected = profileIds.sort().reverse();
  for (const type of ['followers', 'following'] as const) {
    const first = await storage.getUserFollowPage(username, type);
    expect(first.items).toHaveLength(30);
    expect(first.nextCursor).toBe(
      Buffer.from(JSON.stringify([5000, expected[29]])).toString('base64url'),
    );
    const second = await storage.getUserFollowPage(
      username,
      type,
      first.nextCursor!,
    );
    expect(
      [...first.items, ...second.items].map((item) => item.profileId),
    ).toEqual(expected);
    expect(second.nextCursor).toBeNull();
  }
}

export async function assertActivityAndReportPagination(
  storage: IStorage,
  prefix: string,
) {
  const author = `${prefix}-author`;
  const reader = `${prefix}-reader`;
  const reporters = Array.from(
    { length: 7 },
    (_, i) => `${prefix}-reporter${i}`,
  );
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    await storage.ensureUserProfile(author);
    await storage.ensureUserProfile(reader);
    for (const reporter of reporters) await storage.ensureUserProfile(reporter);
    await storage.setUserFollow(reader, author, true);
    const titles = [
      '中文',
      'quote"',
      'slash\\',
      'line\n',
      'space a',
      'space',
      '  ',
      'long'.repeat(45),
      ...Array.from({ length: 28 }, (_, i) => `work-${i}`),
    ];
    for (const title of titles) {
      await storage.setVideoReview(author, {
        ...videoReview,
        title_norm: title,
        updated_at: 2000,
      });
      await storage.reportVideoReview(
        author,
        title,
        '2026',
        reporters[0],
        'spam',
        'first',
      );
    }
    await storage.setVideoReview(author, {
      ...videoReview,
      title_norm: 'at-follow',
      updated_at: 1000,
    });
    await storage.setVideoReview(author, {
      ...videoReview,
      title_norm: 'private',
      updated_at: 2000,
      is_public: false,
    });
    const ids: string[] = [];
    let before: { createdAt: number; key: string } | undefined;
    for (;;) {
      const page = await storage.getFollowReviewMessages(reader, 0, [], 3000, {
        limit: 7,
        before,
      });
      if (!page.length) break;
      ids.push(...page.map((item) => item.id));
      const last = page.at(-1)!;
      before = { createdAt: last.createdAt, key: followReviewSortKey(last.id) };
    }
    expect(ids).toHaveLength(titles.length);
    expect(new Set(ids).size).toBe(titles.length);
    expect(await storage.getFollowReviewMessageCount(reader, 0, [], 3000)).toBe(
      titles.length,
    );
    const seen = ids.slice(0, 5);
    expect(
      await storage.getFollowReviewMessageCount(reader, 0, seen, 3000),
    ).toBe(titles.length - seen.length);
    expect(
      await storage.getFollowReviewMessages(reader, 0, seen, 3000, {
        id: seen[0],
      }),
    ).toEqual([]);
    expect(
      await storage.getFollowReviewMessages(reader, 0, [], 3000, {
        id: ids.at(-1)!,
      }),
    ).toHaveLength(1);
    expect(
      await storage.getFollowReviewMessageCount(reader, 2000, [], 3000),
    ).toBe(0);
    expect(
      await storage.getFollowReviewMessageCount(
        reader,
        0,
        [],
        2000 + 30 * 86400000,
      ),
    ).toBe(0);
    expect(
      await storage.getFollowReviewMessageCount(
        reader,
        0,
        [],
        1999 + 30 * 86400000,
      ),
    ).toBe(titles.length);
    for (const reporter of reporters.slice(1))
      await storage.reportVideoReview(
        author,
        titles[0],
        '2026',
        reporter,
        'spoiler',
        reporter,
      );
    await storage.setVideoReviewLike(author, titles[0], '2026', reader, true);
    const first = await storage.getReviewReportPage();
    const next = await storage.getReviewReportPage(first.nextCursor!);
    const items = [...first.items, ...next.items];
    expect(items).toHaveLength(titles.length);
    expect(new Set(items.map((item) => item.review.title_norm)).size).toBe(
      titles.length,
    );
    expect(first.pendingTotal).toBe(titles.length);
    expect(next.nextCursor).toBeNull();
    const group = items.find((item) => item.review.title_norm === titles[0])!;
    expect(group).toMatchObject({
      reportCount: 7,
      reasons: { spam: 1, spoiler: 6 },
      review: { likeCount: 1 },
    });
    expect(group.reports).toHaveLength(5);
    await storage.moderateReviewReports(author, titles[0], '2026', 'dismiss');
    expect((await storage.getReviewReportPage()).pendingTotal).toBe(
      titles.length - 1,
    );
    await storage.moderateReviewReports(
      author,
      titles[1],
      '2026',
      'delete-review',
    );
    expect((await storage.getReviewReportPage()).pendingTotal).toBe(
      titles.length - 2,
    );
    const oldCursor = Buffer.from(
      JSON.stringify([1000, JSON.stringify([author, titles[0], '2026'])]),
    ).toString('base64url');
    await expect(storage.getReviewReportPage(oldCursor)).rejects.toThrow(
      '举报分页已更新',
    );
  } finally {
    clock.mockRestore();
    for (const username of [author, reader, ...reporters])
      await storage.deleteUser(username);
  }
}

export async function assertPublicReviewRoles(
  storage: IStorage,
  prefix: string,
) {
  const owner = `${prefix}-owner`;
  const admin = `${prefix}-admin`;
  const user = `${prefix}-user`;
  const missing = `${prefix}-missing`;
  const previousOwner = process.env.ICETV_USERNAME;
  try {
    for (const username of [owner, admin, user])
      await storage.registerUser(username, 'test-password');
    await storage.updateUserAccess([owner, admin], { role: 'admin' });
    process.env.ICETV_USERNAME = ` ${owner.toUpperCase()} `;
    const expected = new Map<string, 'owner' | 'admin' | undefined>();
    for (const username of [owner, admin, user, missing]) {
      const profile = await storage.ensureUserProfile(username);
      expected.set(
        profile.profile_id,
        username === owner ? 'owner' : username === admin ? 'admin' : undefined,
      );
      await storage.setVideoReview(username, {
        ...videoReview,
        title_norm: prefix,
      });
    }
    const assertAuthor = (author: import('@/lib/types').PublicUserRef) => {
      expect(expected.has(author.profileId)).toBe(true);
      const role = expected.get(author.profileId);
      if (role) expect(author.role).toBe(role);
      else expect(author).not.toHaveProperty('role');
      expect(author).not.toHaveProperty('username');
    };
    const page = await storage.getWorkVideoReviewPage(
      prefix,
      videoReview.year,
      user,
    );
    expect(page.reviews).toHaveLength(4);
    page.reviews.forEach((review) => assertAuthor(review.author));
    const summary = await storage.getPublicVideoReviewsForWork(
      prefix,
      videoReview.year,
      user,
    );
    expect(summary.reviews).toHaveLength(4);
    summary.reviews.forEach((review) => assertAuthor(review.author));
    for (const username of [owner, admin, user, missing]) {
      const profile = await storage.getUserProfile(username);
      const single = await storage.getPublicReview(
        {
          profileId: profile!.profile_id,
          title_norm: prefix,
          year: videoReview.year,
        },
        user,
      );
      expect(single).not.toBeNull();
      assertAuthor(single!.author);
      const profilePage = await storage.getUserPublicReviewPage(username, user);
      assertAuthor(profilePage.items[0].author);
    }
    // 角色变更后下一次读取使用当前权限，不缓存旧徽标。
    await storage.updateUserAccess([admin], { role: 'user' });
    const demoted = await storage.getUserPublicReviewPage(admin, user);
    expect(demoted.items[0].author).not.toHaveProperty('role');
    process.env.ICETV_USERNAME = ` ${missing.toUpperCase()} `;
    const ownerWithoutAccess = await storage.getUserPublicReviewPage(
      missing,
      user,
    );
    expect(ownerWithoutAccess.items[0].author.role).toBe('owner');
  } finally {
    if (previousOwner === undefined) delete process.env.ICETV_USERNAME;
    else process.env.ICETV_USERNAME = previousOwner;
  }
}

export function videoReviewContract(createStorage: () => IStorage) {
  it('公开评价列表与单条评价返回当前作者角色，普通用户省略字段', async () => {
    await assertPublicReviewRoles(createStorage(), 'review-role');
  });

  it('paginates activity and report groups with tied times, SQL counts and read exclusion', async () => {
    await assertActivityAndReportPagination(createStorage(), 'activity-page');
  });

  it('paginates own reviews with stable ties, server filters and private counts', async () => {
    const storage = createStorage();
    for (let i = 0; i < 45; i++)
      await storage.setVideoReview('page-author', {
        ...videoReview,
        title_norm: `page-${String(i).padStart(2, '0')}`,
        title: `Page ${i}`,
        rating: i % 3 ? 8 : null,
        is_public: i % 2 === 0,
      });
    for (const sort of ['updated', 'high', 'low'] as const) {
      let cursor: string | undefined;
      const seen: VideoReview[] = [];
      do {
        const page = await storage.getMyVideoReviewPage('PAGE-AUTHOR', {
          sort,
          cursor,
        });
        expect(page.items.length).toBeLessThanOrEqual(20);
        expect(page.total).toBe(45);
        expect(page.counts).toEqual({
          all: 45,
          public: 23,
          private: 22,
          text: 15,
        });
        seen.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(seen).toHaveLength(45);
      expect(new Set(seen.map((item) => item.title_norm)).size).toBe(45);
      if (sort !== 'updated')
        expect(seen.slice(-15).every((item) => item.rating === null)).toBe(
          true,
        );
    }
    const page = await storage.getMyVideoReviewPage('page-author', {
      q: 'Page 1',
      filter: 'private',
    });
    expect(
      page.items.every(
        (item) => !item.is_public && item.title.includes('Page 1'),
      ),
    ).toBe(true);
    expect(await storage.getMyVideoReviewCount('page-author')).toBe(45);
    const ratings = await storage.getMyVideoReviewRatings('page-author');
    expect(ratings).toHaveLength(45);
    expect(Object.keys(ratings[0]).sort()).toEqual([
      'rating',
      'title_norm',
      'year',
    ]);
    await expect(
      storage.getMyVideoReviewPage('page-author', { cursor: 'broken' }),
    ).rejects.toThrow();
  });

  it('paginates public work and profile reviews with wildcard years and no private leakage', async () => {
    const storage = createStorage();
    for (let i = 0; i < 25; i++) {
      await storage.ensureUserProfile(`work-author-${i}`);
      await storage.setVideoReview(`work-author-${i}`, {
        ...videoReview,
        year: i % 2 ? '' : '2026',
      });
      await storage.setVideoReview('profile-page-author', {
        ...videoReview,
        title_norm: `profile-${String(i).padStart(2, '0')}`,
      });
    }
    await storage.setVideoReview('hidden-author', {
      ...videoReview,
      is_public: false,
    });
    await storage.setVideoReview('different-year', {
      ...videoReview,
      year: '2025',
    });
    await storage.setVideoReview('profile-page-author', {
      ...videoReview,
      title_norm: 'hidden',
      is_public: false,
    });
    const first = await storage.getWorkVideoReviewPage(
      'reviewdemo',
      '2026',
      'viewer',
    );
    expect(first.reviews).toHaveLength(20);
    expect(first.reviewCount).toBe(25);
    expect(first.count).toBe(25);
    expect(first.average).toBe(8);
    const second = await storage.getWorkVideoReviewPage(
      'reviewdemo',
      '2026',
      'viewer',
      first.nextCursor!,
    );
    expect(second.reviews).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set(
        [...first.reviews, ...second.reviews].map(
          (item) => item.author.profileId,
        ),
      ).size,
    ).toBe(25);
    expect(JSON.stringify(first)).not.toContain('work-author');
    const profileFirst = await storage.getUserPublicReviewPage(
      'profile-page-author',
      'viewer',
    );
    const profileSecond = await storage.getUserPublicReviewPage(
      'profile-page-author',
      'viewer',
      profileFirst.nextCursor!,
    );
    expect(profileFirst.items).toHaveLength(20);
    expect(profileSecond.items).toHaveLength(5);
    expect(
      new Set(
        [...profileFirst.items, ...profileSecond.items].map(
          (item) => item.title_norm,
        ),
      ).size,
    ).toBe(25);
    expect(profileSecond.nextCursor).toBeNull();
  });

  it('paginates both follow directions with stable tied-time cursors', async () => {
    await assertFollowPagination(createStorage(), 'follow-pagination');
  });

  it('atomically merges read ids and never restores stale watermarks or announcements', async () => {
    const storage = createStorage();
    const id = (time: number) =>
      `follow-review:${Buffer.from(JSON.stringify(['AbCdEf012345', 'work', '', time])).toString('base64url')}`;
    await Promise.all(
      [1, 2, 3].map((time) =>
        storage.updateUserMessageState('READER', {
          followReview: { id: id(time), createdAt: time },
        }),
      ),
    );
    expect(
      (await storage.getUserMessageState('reader')).followReviewReadIds,
    ).toHaveLength(3);
    await storage.updateUserMessageState('reader', {
      announcement: { id: 'announcement:200:new', createdAt: 200 },
      announcementReadAt: 100,
      followReviewReadAt: 100,
    });
    await storage.updateUserMessageState('reader', {
      announcement: { id: 'announcement:50:old', createdAt: 50 },
      announcementReadAt: 50,
      followReview: { id: id(2), createdAt: 2 },
      followReviewReadAt: 50,
    });
    expect(await storage.getUserMessageState('reader')).toMatchObject({
      announcementReadAt: 100,
      announcementReadIds: ['announcement:200:new'],
      followReviewReadAt: 100,
      followReviewReadIds: [],
    });
    await storage.updateUserMessageState('reader', {
      followReview: { id: id(300), createdAt: 300 },
    });
    await storage.updateUserMessageState('reader', { followReviewReadAt: 200 });
    expect(
      (await storage.getUserMessageState('reader')).followReviewReadIds,
    ).toEqual([id(300)]);
    await storage.updateUserMessageState('reader', {
      announcement: { id: 'announcement:300:next', createdAt: 300 },
      announcementReadAt: 200,
    });
    expect(
      (await storage.getUserMessageState('reader')).announcementReadIds,
    ).toEqual(['announcement:300:next']);
    for (let time = 301; time <= 502; time++)
      await storage.updateUserMessageState('reader', {
        followReview: { id: id(time), createdAt: time },
      });
    await storage.updateUserMessageState('reader', {
      followReview: { id: id(502), createdAt: 502 },
    });
    const final = await storage.getUserMessageState('reader');
    expect(final.followReviewReadIds).toHaveLength(200);
    expect(new Set(final.followReviewReadIds).size).toBe(200);
    expect(final.followReviewReadIds?.[0]).toBe(id(303));
  });

  it('creates stable profiles and rolls back registration on nickname conflicts', async () => {
    const storage = createStorage();
    await storage.registerUser('social-a', 'test-password', 'Alice');
    const profile = await storage.getUserProfile('SOCIAL-A');
    expect(profile?.profile_id).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(profile?.nickname).toBe('Alice');
    expect(await storage.isNicknameAvailable('alice')).toBe(false);
    expect(await storage.isNicknameAvailable('ALICE', 'SOCIAL-A')).toBe(true);
    await expect(
      storage.registerUser('social-b', 'test-password', 'alice'),
    ).rejects.toThrow('昵称已被使用');
    expect(await storage.checkUserExist('social-b')).toBe(false);
    expect((await storage.ensureUserProfile('SOCIAL-A')).profile_id).toBe(
      profile?.profile_id,
    );
  });

  it('isolates public reactions, groups reports and cascades deletion', async () => {
    const storage = createStorage();
    await storage.ensureUserProfile('author');
    await storage.ensureUserProfile('reader');
    await storage.setVideoReview('author', videoReview);
    expect(
      await storage.setVideoReviewLike(
        'AUTHOR',
        'reviewdemo',
        '2026',
        'READER',
        true,
      ),
    ).toEqual({ liked: true, likeCount: 1 });
    expect(
      await storage.setVideoReviewLike(
        'author',
        'reviewdemo',
        '2026',
        'reader',
        true,
      ),
    ).toEqual({ liked: true, likeCount: 1 });
    await expect(
      storage.setVideoReviewLike(
        'author',
        'reviewdemo',
        '2026',
        'AUTHOR',
        true,
      ),
    ).rejects.toThrow('不能给自己点赞');
    const work = await storage.getPublicVideoReviewsForWork(
      'reviewdemo',
      '2026',
      'reader',
    );
    expect(work.reviews[0]).toMatchObject({
      likedByMe: true,
      likeCount: 1,
      spoiler: false,
    });
    expect(work.reviews[0]).not.toHaveProperty('username');
    await storage.reportVideoReview(
      'author',
      'reviewdemo',
      '2026',
      'reader',
      'spam',
      'first',
    );
    await storage.reportVideoReview(
      'author',
      'reviewdemo',
      '2026',
      'reader',
      'spoiler',
      'second',
    );
    const reports = await storage.getReviewReportPage();
    expect(reports.pendingTotal).toBe(1);
    expect(reports.items[0]).toMatchObject({
      reportCount: 1,
      reasons: { spoiler: 1 },
    });
    await storage.moderateReviewReports(
      'author',
      'reviewdemo',
      '2026',
      'mark-spoiler',
    );
    expect(
      (await storage.getVideoReview('author', 'reviewdemo', '2026'))?.spoiler,
    ).toBe(true);
    expect((await storage.getReviewReportPage()).pendingTotal).toBe(0);
    await storage.deleteVideoReview('author', 'reviewdemo', '2026');
    expect((await storage.getUserSocialData('reader')).likes).toEqual([]);
    await storage.setVideoReview('author', {
      ...videoReview,
      is_public: false,
    });
    expect(
      await storage.setVideoReviewLike(
        'author',
        'reviewdemo',
        '2026',
        'reader',
        true,
      ),
    ).toBeNull();
    expect(
      await storage.reportVideoReview(
        'author',
        'reviewdemo',
        '2026',
        'reader',
        'spam',
        '',
      ),
    ).toBe(false);
  });

  it('uses follow time, read watermarks and public visibility for activity', async () => {
    const storage = createStorage();
    await storage.ensureUserProfile('author');
    await storage.ensureUserProfile('reader');
    await storage.setUserFollow('READER', 'AUTHOR', true);
    const now = Date.now() + 1000;
    await storage.setVideoReview('author', { ...videoReview, updated_at: now });
    const messages = await storage.getFollowReviewMessages(
      'reader',
      0,
      [],
      now,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toHaveProperty('username');
    expect(
      await storage.getFollowReviewMessages('reader', now, [], now),
    ).toEqual([]);
    expect(
      await storage.getFollowReviewMessages('reader', 0, [messages[0].id], now),
    ).toEqual([]);
    expect(
      await storage.getFollowReviewMessages(
        'reader',
        0,
        [],
        now + 31 * 86400000,
      ),
    ).toEqual([]);
    expect(
      (await storage.getUserFollowPage('author', 'followers')).items,
    ).toHaveLength(1);
    expect(await storage.getUserProfileView('author', 'reader')).toMatchObject({
      isFollowing: true,
      followerCount: 1,
      publicReviewCount: 1,
    });
    await storage.deleteUser('AUTHOR');
    expect((await storage.getUserSocialData('reader')).follows).toEqual([]);
    expect(await storage.getUserProfile('author')).toBeNull();
  });

  it('round trips avatar updates through every public profile reference', async () => {
    const storage = createStorage();
    const initial = await storage.ensureUserProfile('author');
    expect(initial.avatar_seed).toBeNull();
    const avatarSeed = 'Avatar012345';
    const author = await storage.updateUserProfile('AUTHOR', { avatarSeed });
    expect(author).toMatchObject({
      profile_id: initial.profile_id,
      nickname: null,
      avatar_seed: avatarSeed,
    });
    await storage.updateUserProfile('author', {
      nickname: 'Author',
      libraryVisibility: 1,
    });
    expect(
      (await storage.getUserProfileById(author.profile_id))?.avatar_seed,
    ).toBe(avatarSeed);
    await storage.updateUserProfile('reader', { avatarSeed: 'Reader012345' });
    await storage.setUserFollow('reader', 'author', true);
    const now = Date.now() + 1000;
    await storage.setVideoReview('author', { ...videoReview, updated_at: now });
    const publicAuthor = {
      profileId: author.profile_id,
      nickname: 'Author',
      avatarSeed,
      level: 1,
    };
    expect(await storage.getUserProfileView('author', 'reader')).toMatchObject(
      publicAuthor,
    );
    expect(
      (await storage.getUserFollowPage('reader', 'following')).items[0],
    ).toMatchObject(publicAuthor);
    expect(
      (await storage.getUserFollowPage('author', 'followers')).items[0]
        .avatarSeed,
    ).toBe('Reader012345');
    expect(
      (await storage.getUserPublicReviewPage('author', 'reader')).items[0]
        .author,
    ).toEqual(publicAuthor);
    expect(
      (
        await storage.getPublicVideoReviewsForWork(
          'reviewdemo',
          '2026',
          'reader',
        )
      ).reviews[0].author,
    ).toEqual(publicAuthor);
    expect(
      (await storage.getFollowReviewMessages('reader', 0, [], now))[0].author,
    ).toEqual(publicAuthor);
    await storage.reportVideoReview(
      'author',
      'reviewdemo',
      '2026',
      'reader',
      'spam',
      '',
    );
    const reports = await storage.getReviewReportPage();
    expect(reports.items[0].review.author).toEqual(publicAuthor);
    expect(reports.items[0].reports[0].reporter.avatarSeed).toBe(
      'Reader012345',
    );
    expect(
      (await storage.getUserSocialData('author')).profile?.avatar_seed,
    ).toBe(avatarSeed);
    await expect(
      storage.updateUserProfile('author', { avatarSeed: 'bad' }),
    ).rejects.toThrow('头像参数无效');
    expect((await storage.getUserProfile('author'))?.avatar_seed).toBe(
      avatarSeed,
    );
    await storage.updateUserProfile('author', { avatarSeed: null });
    expect((await storage.getUserProfile('author'))?.avatar_seed).toBeNull();
  });

  it('matches exact years, falls back to unknown, and preserves creation time', async () => {
    const storage = createStorage();
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
    expect(summary.reviews.every((row) => !('username' in row))).toBe(true);
    expect(summary.distribution[5]).toBe(52);
    expect(summary.distribution[9]).toBe(1);
    expect(summary.reviews[0]).not.toHaveProperty('source_key');
    expect(
      (await storage.getPublicVideoReviewsForWork('reviewdemo', '')).count,
    ).toBe(54);
    expect(await storage.getPublicVideoReviewsForWork('missing', '')).toEqual({
      average: null,
      count: 0,
      distribution: Array(10).fill(0),
      reviews: [],
    });
    await storage.deleteVideoReview('private', 'reviewdemo', '2026', true);
    expect(await storage.getAllVideoReviews('private')).toHaveLength(1);
  });

  it('paginates timestamp ties without duplicates and treats LIKE wildcards literally', async () => {
    const storage = createStorage();
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
}
