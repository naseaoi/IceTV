import { videoReview } from '@/lib/__tests__/__fixtures__/video-review-contract';
import { messageSortKey } from '@/lib/message-cursor.server';
import type { IStorage } from '@/lib/types';
import { mergeUserMessageState } from '@/lib/user-message-state';
import type { UserNoticeMessage } from '@/lib/user-notice';

export function userNoticeContract(createStorage: () => IStorage) {
  let storage: IStorage;
  const messages = (user: string) =>
    storage.getUserNoticeMessages(user, 0, [], Date.now(), { limit: 100 });
  beforeEach(async () => {
    storage = createStorage();
    for (const user of ['notice-author', 'notice-replier', 'notice-reporter'])
      await storage.registerUser(user, 'password');
    await storage.setVideoReview('notice-author', videoReview);
  });
  it('删除评价按收件人合并级联内容，举报结果仅给举报人，重试不重复', async () => {
    const target = [
      'notice-author',
      videoReview.title_norm,
      videoReview.year,
    ] as const;
    const first = await storage.postReviewReply(
      ...target,
      'notice-replier',
      '敏感回复全文',
    );
    await storage.postReviewReply(...target, 'notice-replier', '另一条回复');
    await storage.reportVideoReview(
      ...target,
      'notice-reporter',
      'other',
      '举报详情',
    );
    await storage.reportReviewReply(
      first!.id,
      'notice-reporter',
      'other',
      '举报详情',
    );
    await storage.deleteVideoReview(...target, true);
    await storage.deleteVideoReview(...target, true);
    expect(await messages('notice-author')).toEqual([
      expect.objectContaining({
        type: 'content-moderated',
        payload: expect.objectContaining({ count: 1 }),
      }),
    ]);
    expect(await messages('notice-replier')).toEqual([
      expect.objectContaining({
        type: 'content-moderated',
        payload: expect.objectContaining({ count: 2, contentType: 'reply' }),
      }),
    ]);
    const reports = await messages('notice-reporter');
    expect(reports).toHaveLength(2);
    expect(reports.every((item) => item.type === 'report-result')).toBe(true);
    const payloads = JSON.stringify([
      await messages('notice-author'),
      await messages('notice-replier'),
      reports,
    ]);
    expect(payloads).not.toMatch(/敏感回复全文|举报详情|notice-reporter/);
    expect(
      (await storage.getReviewReplies(...target, 'notice-author')).items,
    ).toHaveLength(0);
  });
  it('标记剧透只在实际变化时提醒；驳回与回复删除原子清理举报', async () => {
    const target = [
      'notice-author',
      videoReview.title_norm,
      videoReview.year,
    ] as const;
    await storage.reportVideoReview(...target, 'notice-reporter', 'other', '');
    await storage.moderateReviewReports(...target, 'mark-spoiler');
    await storage.moderateReviewReports(...target, 'mark-spoiler');
    expect(await messages('notice-author')).toHaveLength(1);
    expect((await storage.getVideoReview(...target))?.spoiler).toBe(true);
    expect(await messages('notice-reporter')).toHaveLength(1);
    const reply = await storage.postReviewReply(
      ...target,
      'notice-replier',
      '回复',
    );
    await storage.reportReviewReply(reply!.id, 'notice-reporter', 'other', '');
    await storage.moderateReplyReports(reply!.id, 'dismiss');
    expect(await messages('notice-replier')).toHaveLength(0);
    expect(await storage.deleteReviewReply(reply!.id, '', true)).toBe(true);
    expect(await storage.deleteReviewReply(reply!.id, '', true)).toBe(false);
    expect(await messages('notice-replier')).toHaveLength(1);
  });
  it('本人删除不通知；弹幕跨集按作品合并且删除重试幂等', async () => {
    await storage.deleteVideoReview(
      'notice-author',
      videoReview.title_norm,
      videoReview.year,
    );
    expect(await messages('notice-author')).toHaveLength(0);
    for (let i = 0; i < 3; i++)
      await storage.addUserDanmaku({
        id: `notice-danmaku-${i}`,
        username: 'notice-author',
        episodeKey: `dandan:${i + 1}`,
        title: i < 2 ? '作品一' : '作品二',
        year: '2026',
        timeMs: 1000,
        text: '删除全文',
        mode: 0,
        color: '#ffffff',
        createdAt: Date.now(),
      });
    const ids = ['notice-danmaku-0', 'notice-danmaku-1', 'notice-danmaku-2'];
    expect(await storage.deleteUserDanmakuBatch(ids)).toBe(3);
    expect(await storage.deleteUserDanmakuBatch(ids)).toBe(0);
    const notices = await messages('notice-author');
    expect(notices).toHaveLength(2);
    expect(notices.map((item) => item.payload.count).sort()).toEqual([1, 2]);
    expect(JSON.stringify(notices)).not.toContain('删除全文');
  });
  it('账号变更仅实际修改通知，管理员改密幂等且不保存密码', async () => {
    const user = 'notice-author';
    await storage.updateUserAccess([user], { role: 'admin' });
    await storage.updateUserAccess([user], { role: 'admin' });
    await storage.updateUserAccess([user], { role: 'user' });
    await storage.updateUserAccess([user], { banned: true });
    await storage.updateUserAccess([user], { banned: false });
    await storage.updateUserAccess([user], { banned: false });
    await storage.updateUserAccess([user], { enabledApis: ['one'] });
    await storage.updateUserAccess([user], { enabledApis: ['one'] });
    await storage.changePassword(user, 'new-secret-password', true);
    await storage.changePassword(user, 'new-secret-password', true);
    const notices = await messages(user);
    expect(notices.map((item) => item.action).sort()).toEqual(
      [
        'set-admin',
        'cancel-admin',
        'unban',
        'permissions-changed',
        'password-changed',
      ].sort(),
    );
    expect(JSON.stringify(notices)).not.toMatch(
      /new-secret-password|password\$/,
    );
    await storage.deleteUser(user);
    expect(await messages(user)).toHaveLength(0);
  });
  it('用户组权限实际变化通知受影响成员，配置重复保存与等效组不通知', async () => {
    const config = {
      SourceConfig: [
        { key: 'one', disabled: false },
        { key: 'two', disabled: false },
      ],
      SiteConfig: { EnableLiveEntry: true, LiveAccess: 'groups' },
      UserConfig: {
        Tags: [
          { name: 'group', enabledApis: ['one'] },
          { name: 'same', enabledApis: ['one'] },
        ],
      },
    } as unknown as import('@/types/admin').AdminConfig;
    await storage.setAdminConfig(config);
    await storage.updateUserAccess(['notice-author'], { tags: ['group'] });
    const baseline = (await messages('notice-author')).length;
    await storage.updateUserAccess(['notice-author'], { tags: ['same'] });
    expect(await messages('notice-author')).toHaveLength(baseline);
    const next = {
      ...config,
      UserConfig: {
        ...config.UserConfig,
        Tags: [
          { name: 'group', enabledApis: ['one'] },
          { name: 'same', enabledApis: ['two'] },
        ],
      },
    };
    expect(await storage.compareAndSetAdminConfig(config, next)).toBe(true);
    expect(await messages('notice-author')).toHaveLength(baseline + 1);
    expect(await storage.compareAndSetAdminConfig(next, next)).toBe(true);
    expect(await messages('notice-author')).toHaveLength(baseline + 1);
    await storage.updateUserAccess(['notice-author'], { enabledApis: ['one'] });
    const overridden = (await messages('notice-author')).length;
    expect(await storage.compareAndSetAdminConfig(next, config)).toBe(true);
    expect(await messages('notice-author')).toHaveLength(overridden);
  });
  it('同毫秒游标分页、单条已读、压缩和保留期两后端一致', async () => {
    const user = 'notice-author';
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      for (const role of ['admin', 'user', 'admin'] as const)
        await storage.updateUserAccess([user], { role });
      const first = await storage.getUserNoticeMessages(user, 0, [], now, {
        limit: 2,
      });
      const second = await storage.getUserNoticeMessages(user, 0, [], now, {
        limit: 2,
        before: { createdAt: now, key: messageSortKey(first[1]) },
      });
      expect(
        await storage.getUserNoticeMessages(user, 0, [], now, {
          limit: 10,
          before: { createdAt: now, key: 'tracking:source+video' },
        }),
      ).toHaveLength(0);
      expect(
        await storage.getUserNoticeMessages(user, 0, [], now, {
          limit: 10,
          before: { createdAt: now, key: 'zz:tail' },
        }),
      ).toHaveLength(3);
      expect(
        await storage.getUserNoticeCount(user, 0, [], now + 30 * 86400000),
      ).toBe(0);
      expect(first).toHaveLength(2);
      expect(second).toHaveLength(1);
      expect(new Set([...first, ...second].map((item) => item.id)).size).toBe(
        3,
      );
      await storage.updateUserMessageState(user, {
        userNotice: { id: first[0].id, createdAt: now },
      });
      const state = await storage.getUserMessageState(user);
      expect(
        await storage.getUserNoticeCount(
          user,
          state.userNoticeReadAt ?? 0,
          state.userNoticeReadIds ?? [],
          now,
        ),
      ).toBe(2);
      await storage.updateUserMessageState(user, { userNoticeReadAt: now });
      expect(await storage.getUserNoticeCount(user, now, [], now)).toBe(0);
      expect(await storage.purgeUserNotices(now - 1)).toBe(0);
      expect(await storage.purgeUserNotices(now)).toBe(3);
    } finally {
      clock.mockRestore();
    }
    let state = {};
    for (let i = 1; i <= 202; i++)
      state = mergeUserMessageState(state, {
        userNotice: {
          id: `user-notice:${i}:00000000-0000-4000-8000-000000000001`,
          createdAt: i,
        },
      });
    expect(state).toMatchObject({
      userNoticeReadAt: 2,
      userNoticeReadIds: expect.any(Array),
    });
    expect(
      mergeUserMessageState(state, { userNoticeReadAt: 100 }),
    ).toMatchObject({ userNoticeReadAt: 100 });
  });
}

export const noticeMessage: UserNoticeMessage = {
  id: 'user-notice:1000:00000000-0000-4000-8000-000000000001',
  type: 'account-change',
  action: 'set-admin',
  payload: {},
  createdAt: 1000,
};
