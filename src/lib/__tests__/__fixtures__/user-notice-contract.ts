import { videoReview } from '@/lib/__tests__/__fixtures__/video-review-contract';
import { messageSortKey } from '@/lib/message-cursor.server';
import type { IStorage } from '@/lib/types';
import { mergeUserMessageState } from '@/lib/user-message-state';
import { type UserNoticeMessage, userNoticeText } from '@/lib/user-notice';
import { PERMISSION_NOTICE_QUIET_MS } from '@/lib/user-notice-storage';
import type { AdminConfig } from '@/types/admin';

export function userNoticeContract(createStorage: () => IStorage) {
  let storage: IStorage;
  const messages = (user: string) =>
    storage.getUserNoticeMessages(user, 0, [], Date.now(), { limit: 100 });
  let clockSpy: jest.SpyInstance | undefined;
  const fakeClock = () => {
    let now = Date.now();
    clockSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    return (ms: number) => {
      now += ms;
    };
  };
  afterEach(() => clockSpy?.mockRestore());
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
    await storage.setAdminConfig({
      SourceConfig: [{ key: 'one' }, { key: 'two' }],
    } as AdminConfig);
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
    for (const [action, text] of [
      ['set-admin', '你已被设为管理员'],
      ['cancel-admin', '你的管理员身份已取消'],
      ['unban', '你的账号已解除封禁'],
      ['password-changed', '管理员已修改你的登录密码'],
    ]) {
      expect(
        userNoticeText(notices.find((item) => item.action === action)!),
      ).toBe(text);
    }
    expect(
      userNoticeText({
        type: 'account-change',
        action: 'permissions-changed',
        payload: {},
      }),
    ).toBe('你的访问权限已更新');
    expect(JSON.stringify(notices)).not.toMatch(
      /new-secret-password|password\$/,
    );
    await storage.deleteUser(user);
    expect(await messages(user)).toHaveLength(0);
  });
  it('源与直播权限差异在事务中合并，等效组和配置不通知', async () => {
    const user = 'notice-author';
    let config = {
      SourceConfig: [
        ...['one', 'two', 'three', 'four', 'five'].map((key) => ({ key })),
        { key: 'disabled', disabled: true },
        { key: 'hidden', adminOnly: true },
      ],
      SiteConfig: { EnableLiveEntry: true, LiveAccess: 'groups' },
      UserConfig: {
        Tags: [
          { name: 'group', enabledApis: ['one', 'two'] },
          { name: 'same', enabledApis: ['one', 'two'] },
          { name: 'live', enabledApis: ['five'], allowLive: true },
        ],
      },
    } as AdminConfig;
    await storage.setAdminConfig(config);
    let seen = new Set((await messages(user)).map((item) => item.id));
    const expectChange = async (
      payload?: UserNoticeMessage['payload'],
      text?: string,
    ) => {
      const all = await messages(user);
      const added = all.filter((item) => !seen.has(item.id));
      expect(added).toHaveLength(payload ? 1 : 0);
      if (payload) {
        expect(added[0]).toMatchObject({
          type: 'account-change',
          action: 'permissions-changed',
          payload,
        });
        expect(userNoticeText(added[0])).toBe(text);
      }
      seen = new Set(all.map((item) => item.id));
    };
    const advance = fakeClock();
    // 配置改动的通知在静默期后才可见，这里每次保存后越过静默期，逐次断言
    const save = async (next: AdminConfig) => {
      expect(await storage.compareAndSetAdminConfig(config, next)).toBe(true);
      config = next;
      advance(PERMISSION_NOTICE_QUIET_MS + 1);
    };
    await storage.updateUserAccess([user], { tags: ['group'] });
    await expectChange(
      { sourcesAdded: 0, sourcesRemoved: 3 },
      '你的可用视频源减少了 3 个',
    );
    await storage.updateUserAccess([user], { tags: ['same', 'group'] });
    await expectChange();
    await storage.updateUserAccess([user], { tags: ['same'] });
    await expectChange();

    const previous = config;
    await save({
      ...config,
      UserConfig: {
        ...config.UserConfig,
        Tags: config.UserConfig.Tags!.map((group) =>
          group.name === 'same'
            ? {
                ...group,
                enabledApis: ['three', 'four', 'five', 'disabled', 'hidden'],
                allowLive: true,
              }
            : group,
        ),
      },
    });
    await expectChange(
      { sourcesAdded: 3, sourcesRemoved: 2, liveAllowed: true },
      '你的可用视频源已调整：新增 3 个，移除 2 个；你现在可以观看直播了',
    );
    expect(await storage.compareAndSetAdminConfig(previous, previous)).toBe(
      false,
    );
    await save(config);
    await expectChange();

    await storage.updateUserAccess([user], {
      enabledApis: ['three', 'disabled', 'hidden'],
    });
    await expectChange(
      { sourcesAdded: 0, sourcesRemoved: 2 },
      '你的可用视频源减少了 2 个',
    );
    await storage.updateUserAccess([user], { enabledApis: ['three'] });
    await expectChange();
    await storage.updateUserAccess([user], { tags: ['group'] });
    await expectChange(
      { sourcesAdded: 0, sourcesRemoved: 0, liveAllowed: false },
      '你的直播访问权限已关闭',
    );
    await storage.updateUserAccess([user], { tags: ['live'] });
    await expectChange(
      { sourcesAdded: 0, sourcesRemoved: 0, liveAllowed: true },
      '你现在可以观看直播了',
    );
    await storage.updateUserAccess([user], { tags: ['same'] });
    await expectChange();
    await save({
      ...config,
      UserConfig: {
        ...config.UserConfig,
        Tags: config.UserConfig.Tags!.map((group) => ({
          ...group,
          enabledApis: ['one'],
        })),
      },
    });
    await expectChange();

    // 删除最后一个个人授权源后，按原有规则回落到用户组。
    await save({
      ...config,
      SourceConfig: config.SourceConfig.filter(
        (source) => source.key !== 'three',
      ),
    });
    expect((await storage.getUserAccess(user))?.enabledApis).toBeUndefined();
    await expectChange(
      { sourcesAdded: 1, sourcesRemoved: 1 },
      '你的可用视频源已调整：新增 1 个，移除 1 个',
    );
    // 删除所处用户组后，按原有规则回落到全部启用的普通源。
    await save({
      ...config,
      UserConfig: {
        ...config.UserConfig,
        Tags: config.UserConfig.Tags!.filter((group) => group.name !== 'same'),
      },
    });
    await expectChange(
      { sourcesAdded: 3, sourcesRemoved: 0, liveAllowed: false },
      '你的可用视频源增加了 3 个；你的直播访问权限已关闭',
    );
    expect((await storage.getUserAccess(user))?.tags).toBeUndefined();

    await save({
      ...config,
      SourceConfig: config.SourceConfig.map((source) =>
        ['one', 'two', 'four'].includes(source.key)
          ? { ...source, disabled: true }
          : source,
      ),
    });
    await expectChange(
      { sourcesAdded: 0, sourcesRemoved: 3 },
      '你的可用视频源减少了 3 个',
    );
    await save({
      ...config,
      SourceConfig: config.SourceConfig.map((source) =>
        ['one', 'two', 'four'].includes(source.key)
          ? { ...source, disabled: false }
          : source,
      ),
    });
    await expectChange(
      { sourcesAdded: 3, sourcesRemoved: 0 },
      '你的可用视频源增加了 3 个',
    );
    await save({
      ...config,
      SourceConfig: config.SourceConfig.map((source) =>
        source.key === 'hidden' ? { ...source, adminOnly: false } : source,
      ),
    });
    await expectChange(
      { sourcesAdded: 1, sourcesRemoved: 0 },
      '你的可用视频源增加了 1 个',
    );
    await save({
      ...config,
      SourceConfig: config.SourceConfig.map((source) =>
        source.key === 'hidden' ? { ...source, adminOnly: true } : source,
      ),
    });
    await expectChange(
      { sourcesAdded: 0, sourcesRemoved: 1 },
      '你的可用视频源减少了 1 个',
    );
    await save({
      ...config,
      SiteConfig: { ...config.SiteConfig, LiveAccess: 'all' },
    });
    await expectChange(
      { sourcesAdded: 0, sourcesRemoved: 0, liveAllowed: true },
      '你现在可以观看直播了',
    );
    await save({
      ...config,
      SiteConfig: { ...config.SiteConfig, EnableLiveEntry: false },
    });
    await expectChange(
      { sourcesAdded: 0, sourcesRemoved: 0, liveAllowed: false },
      '你的直播访问权限已关闭',
    );
    await save({
      ...config,
      SiteConfig: { ...config.SiteConfig, LiveAccess: 'groups' },
    });
    await expectChange();
    await storage.updateUserAccess([user], { tags: ['live'] });
    await expectChange(
      { sourcesAdded: 0, sourcesRemoved: 3 },
      '你的可用视频源减少了 3 个',
    );
    await storage.updateUserAccess([user], { enabledApis: [] });
    await expectChange();
  });
  it('静默期内的连续配置改动合并为一条净变化通知，管理员不收', async () => {
    const user = 'notice-author';
    const admin = 'notice-replier';
    const advance = fakeClock();
    await storage.updateUserAccess([admin], { role: 'admin' });
    const visible = () => messages(user);
    let config = {
      SourceConfig: ['one', 'two', 'three'].map((key) => ({ key })),
    } as AdminConfig;
    await storage.setAdminConfig(config);
    const save = async (next: AdminConfig) => {
      expect(await storage.compareAndSetAdminConfig(config, next)).toBe(true);
      config = next;
      advance(10000);
    };
    const toggle = (keys: string[], disabled: boolean) => ({
      ...config,
      SourceConfig: config.SourceConfig.map((source) =>
        keys.includes(source.key) ? { ...source, disabled } : source,
      ),
    });
    await save(toggle(['one', 'two'], true));
    await save(toggle(['one'], false));
    await save({
      ...config,
      SourceConfig: [
        ...config.SourceConfig,
        { key: 'four' } as AdminConfig['SourceConfig'][number],
      ],
    });
    expect(await visible()).toHaveLength(0);
    advance(PERMISSION_NOTICE_QUIET_MS);
    const [notice, ...rest] = await visible();
    expect(rest).toHaveLength(0);
    expect(notice.payload).toEqual({ sourcesAdded: 1, sourcesRemoved: 1 });
    expect(userNoticeText(notice)).toBe(
      '你的可用视频源已调整：新增 1 个，移除 1 个',
    );

    advance(1);
    await save(toggle(['three'], true));
    await save(toggle(['three'], false));
    advance(PERMISSION_NOTICE_QUIET_MS);
    expect(await visible()).toHaveLength(1);
    expect((await messages(admin)).map((item) => item.action)).toEqual([
      'set-admin',
    ]);
  });
  it('待发期间的个人权限变更先结算待发通知，临近可见的待发通知不再合并', async () => {
    const user = 'notice-author';
    const advance = fakeClock();
    let config = {
      SourceConfig: [{ key: 'one' }],
      SiteConfig: { EnableLiveEntry: true, LiveAccess: 'all' },
      UserConfig: { Tags: [{ name: 'live', allowLive: true }] },
    } as unknown as AdminConfig;
    await storage.setAdminConfig(config);
    const save = async (next: AdminConfig) => {
      expect(await storage.compareAndSetAdminConfig(config, next)).toBe(true);
      config = next;
    };
    const texts = async () =>
      (await messages(user)).map((item) => userNoticeText(item)).reverse();

    await save({
      ...config,
      SiteConfig: { ...config.SiteConfig, LiveAccess: 'groups' },
    });
    advance(1000);
    await storage.updateUserAccess([user], { tags: ['live'] });
    advance(1000);
    await save({
      ...config,
      SiteConfig: { ...config.SiteConfig, EnableLiveEntry: false },
    });
    expect(await texts()).toEqual([
      '你的直播访问权限已关闭',
      '你现在可以观看直播了',
    ]);
    advance(PERMISSION_NOTICE_QUIET_MS);
    expect((await texts()).at(-1)).toBe('你的直播访问权限已关闭');
    expect(await texts()).toHaveLength(3);

    advance(1);
    const disable = (disabled: boolean) => ({
      ...config,
      SourceConfig: [{ ...config.SourceConfig[0], disabled }],
    });
    await save(disable(true));
    advance(PERMISSION_NOTICE_QUIET_MS - 10000);
    await save(disable(false));
    advance(PERMISSION_NOTICE_QUIET_MS);
    expect((await texts()).slice(3)).toEqual([
      '你的可用视频源减少了 1 个',
      '你的可用视频源增加了 1 个',
    ]);
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
