/** @jest-environment node */

import { IMPORT_ADMIN_CONFIG } from '@/lib/__tests__/__fixtures__/import-admin-config';
import { assertReviewReplies } from '@/lib/__tests__/__fixtures__/review-reply-contract';
import { videoReview } from '@/lib/__tests__/__fixtures__/video-review-contract';
import { publicUserRole } from '@/lib/public-user-role.server';
import { replySchema, ReviewReplyStorage } from '@/lib/review-reply-storage';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import { mergeUserMessageState } from '@/lib/user-message-state';

it('公开角色优先匹配归一化环境站长，并保留表内 owner 与 admin', () => {
  const previousOwner = process.env.ICETV_USERNAME;
  try {
    process.env.ICETV_USERNAME = ' Site-Owner ';
    expect(publicUserRole('SITE-OWNER', 'user')).toBe('owner');
    expect(publicUserRole('site-owner', 'admin')).toBe('owner');
    expect(publicUserRole('site-owner', null)).toBe('owner');
    expect(publicUserRole('table-owner', 'owner')).toBe('owner');
    expect(publicUserRole('moderator', 'admin')).toBe('admin');
    for (const role of ['user', 'unexpected', null, undefined])
      expect(publicUserRole('reader', role)).toBeUndefined();
    delete process.env.ICETV_USERNAME;
    expect(publicUserRole('', null)).toBeUndefined();
  } finally {
    if (previousOwner === undefined) delete process.env.ICETV_USERNAME;
    else process.env.ICETV_USERNAME = previousOwner;
  }
});

it('回复公开性、权限、提醒去重、已读与评价级联删除', async () => {
  await assertReviewReplies(new LocalSqliteStorage(':memory:'), 'reply');
});

it('回复备份替换与删除用户覆盖发送者、评价作者、被提及者和举报人', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  for (const username of ['author', 'reader', 'third'])
    await storage.ensureUserProfile(username);
  await storage.setVideoReview('author', videoReview);
  const target = ['author', videoReview.title_norm, videoReview.year] as const;
  const first = await storage.postReviewReply(...target, 'reader', '第一条');
  const second = await storage.postReviewReply(
    ...target,
    'third',
    '第二条',
    first!.id,
  );
  await storage.reportReviewReply(second!.id, 'reader', 'spam', '');
  const userData = Object.fromEntries(
    await Promise.all(
      ['author', 'reader', 'third'].map(async (username) => [
        username,
        {
          playRecords: {},
          favorites: {},
          searchHistory: [],
          skipConfigs: {},
          playbackSessions: {},
          videoReviews: await storage.getAllVideoReviews(username),
          ...(await storage.getUserSocialData(username)),
        },
      ]),
    ),
  );
  await storage.replaceAllData({
    adminConfig: IMPORT_ADMIN_CONFIG,
    users: {},
    userData,
    sourceRouteStats: [],
    inviteCodeUsage: {},
  });
  expect(
    (await storage.getReviewReplies(...target, 'third')).items,
  ).toHaveLength(2);
  await storage.deleteUser('reader');
  const remaining = (await storage.getReviewReplies(...target, 'third')).items;
  expect(remaining).toHaveLength(1);
  expect(remaining[0].replyTo).toBeNull();
  expect((await storage.getUserSocialData('reader')).replyReports).toEqual([]);
  await storage.deleteUser('author');
  expect((await storage.getUserSocialData('third')).replies).toEqual([]);
});

it('同毫秒回复按稳定标识正序分页', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  await storage.ensureUserProfile('author');
  await storage.ensureUserProfile('reader');
  await storage.setVideoReview('author', videoReview);
  const clock = jest.spyOn(Date, 'now').mockReturnValue(10000);
  try {
    for (let i = 0; i < 43; i++)
      await storage.postReviewReply(
        'author',
        videoReview.title_norm,
        videoReview.year,
        'reader',
        `回复${i}`,
      );
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await storage.getReviewReplies(
        'author',
        videoReview.title_norm,
        videoReview.year,
        'reader',
        cursor ?? undefined,
      );
      expect(page.items.length).toBeLessThanOrEqual(20);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(43);
    expect(new Set(ids).size).toBe(43);
    expect(ids).toEqual([...ids].sort());
  } finally {
    clock.mockRestore();
  }
});

it('回复已读集合压缩水位并保留全部已读之后的并发已读', () => {
  const id = (time: number) =>
    `review-reply:${time}:00000000-0000-4000-8000-${String(time).padStart(12, '0')}`;
  const state = mergeUserMessageState(
    { reviewReplyReadIds: Array.from({ length: 200 }, (_, i) => id(i + 1)) },
    { reviewReply: { id: id(201), createdAt: 201 } },
  );
  expect(state.reviewReplyReadAt).toBe(1);
  expect(state.reviewReplyReadIds).toHaveLength(200);
  expect(
    mergeUserMessageState(state, { reviewReplyReadAt: 200 }).reviewReplyReadIds,
  ).toEqual([id(201)]);
  expect(
    mergeUserMessageState(state, { reviewReplyReadAt: 0 }).reviewReplyReadAt,
  ).toBe(1);
});

it('两套方言共享公开与收件人谓词且 MySQL 文本逐字匹配', async () => {
  const sqls: string[] = [];
  for (const dialect of ['sqlite', 'mysql'] as const) {
    const storage = new ReviewReplyStorage({
      dialect,
      rows: async <T>(sql: string) => {
        sqls.push(sql);
        return [{ count: 0 }] as T[];
      },
      run: async () => 0,
    });
    await storage.getReviewReplyMessageCount('author', 0, [], Date.now());
  }
  expect(sqls[0]).toBe(sqls[1]);
  expect(sqls[0]).toContain(
    '(r.author = ? OR r.reply_to = ?) AND r.username <> ?',
  );
  expect(sqls[0]).toContain('v.is_public = 1');
  expect(replySchema('mysql').every((sql) => sql.includes('utf8mb4_bin'))).toBe(
    true,
  );
});
