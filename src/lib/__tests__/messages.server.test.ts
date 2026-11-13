/** @jest-environment node */

import type { SiteAnnouncement } from '@/lib/types';

const mockGetCapsuleMessages = jest.fn();
const mockOpenCapsule = jest.fn();
const mockReadAllCapsules = jest.fn();
const mockGetFavoriteUpdateMessagePage = jest.fn();
const mockGetFavorite = jest.fn();
const mockReadFavoriteUpdate = jest.fn();
const mockGetUserNoticeMessages = jest.fn();
const mockGetUserNoticeCount = jest.fn();
const mockHasPlaybackAnnualActivity = jest.fn();
const mockGetSocialNotifications = jest.fn();
const mockGetSocialNotificationCount = jest.fn();
const mockGetReviewReplyMessages = jest.fn();
const mockGetReviewReplyMessageCount = jest.fn();
const mockGetFollowRecapMessages = jest.fn();
const mockGetFollowRecapMessageCount = jest.fn();
const mockGetFollowReviewMessages = jest.fn();
const mockGetFollowReviewMessageCount = jest.fn();
const mockGetPublishedAnnouncements = jest.fn();
const mockGetAnnouncement = jest.fn();
const mockGetAllPlayRecords = jest.fn();
const mockGetUnreadTrackingPlayRecordPage = jest.fn();
const mockGetUserMessageState = jest.fn();
const mockUpdateUserMessageState = jest.fn();
const mockGetPlayRecord = jest.fn();
const mockSavePlayRecord = jest.fn();
const mockSavePlayRecordsByKey = jest.fn();

jest.mock('@/lib/db', () => ({
  db: {
    getCapsuleMessages: (...args: unknown[]) => mockGetCapsuleMessages(...args),
    openCapsule: (...args: unknown[]) => mockOpenCapsule(...args),
    readAllCapsules: (...args: unknown[]) => mockReadAllCapsules(...args),
    getFavoriteUpdateMessagePage: (...args: unknown[]) =>
      mockGetFavoriteUpdateMessagePage(...args),
    getFavorite: (...args: unknown[]) => mockGetFavorite(...args),
    readFavoriteUpdate: (...args: unknown[]) => mockReadFavoriteUpdate(...args),
    getUserNoticeMessages: (...args: unknown[]) =>
      mockGetUserNoticeMessages(...args),
    getUserNoticeCount: (...args: unknown[]) => mockGetUserNoticeCount(...args),
    getFollowRecapMessages: (...args: unknown[]) =>
      mockGetFollowRecapMessages(...args),
    getFollowRecapMessageCount: (...args: unknown[]) =>
      mockGetFollowRecapMessageCount(...args),
    hasPlaybackAnnualActivity: (...args: unknown[]) =>
      mockHasPlaybackAnnualActivity(...args),
    getPublishedAnnouncements: (...args: unknown[]) =>
      mockGetPublishedAnnouncements(...args),
    getAnnouncement: (...args: unknown[]) => mockGetAnnouncement(...args),
    getSocialNotifications: (...args: unknown[]) =>
      mockGetSocialNotifications(...args),
    getSocialNotificationCount: (...args: unknown[]) =>
      mockGetSocialNotificationCount(...args),
    getReviewReplyMessages: (...args: unknown[]) =>
      mockGetReviewReplyMessages(...args),
    getReviewReplyMessageCount: (...args: unknown[]) =>
      mockGetReviewReplyMessageCount(...args),
    getFollowReviewMessageCount: (...args: unknown[]) =>
      mockGetFollowReviewMessageCount(...args),
    getFollowReviewMessages: (...args: unknown[]) =>
      mockGetFollowReviewMessages(...args),
    getAllPlayRecords: (...args: unknown[]) => mockGetAllPlayRecords(...args),
    getUnreadTrackingPlayRecordPage: (...args: unknown[]) =>
      mockGetUnreadTrackingPlayRecordPage(...args),
    getUserMessageState: (...args: unknown[]) =>
      mockGetUserMessageState(...args),
    updateUserMessageState: (...args: unknown[]) =>
      mockUpdateUserMessageState(...args),
    getPlayRecord: (...args: unknown[]) => mockGetPlayRecord(...args),
    savePlayRecord: (...args: unknown[]) => mockSavePlayRecord(...args),
    savePlayRecordsByKey: (...args: unknown[]) =>
      mockSavePlayRecordsByKey(...args),
  },
}));

import {
  getAnnouncementHistory,
  getUserMessagePage,
  getUserMessageSummary,
  readAllUserMessages,
  readUserMessage,
} from '@/lib/messages.server';
import type {
  PlayRecord,
  UserMessageState,
  UserMessageStateUpdate,
} from '@/lib/types';
import { mergeUserMessageState } from '@/lib/user-message-state';

const announcementRow: SiteAnnouncement = {
  id: 'a2',
  content: '维护完成，欢迎回来。',
  createdAt: 1_000,
  updatedAt: 1_000,
  publishedAt: 5_000,
};
const ANNOUNCEMENT_ID = 'announcement:5000:a2';

const updatedRecord: PlayRecord = {
  title: '示例剧集',
  source_name: '示例源',
  cover: '/cover.jpg',
  year: '2026',
  index: 8,
  total_episodes: 12,
  play_time: 120,
  total_time: 1_200,
  save_time: 1_000,
  metadata_checked_at: 4_000,
  update_detected_at: 4_000,
  update_baseline_episodes: 10,
  tracking_enabled: true,
};

function usePersistedUserMessageState(): void {
  let state: UserMessageState = {};
  mockGetUserMessageState.mockImplementation(() => Promise.resolve(state));
  mockUpdateUserMessageState.mockImplementation(
    (_userName: string, update: UserMessageStateUpdate) => {
      state = mergeUserMessageState(state, update);
      return Promise.resolve();
    },
  );
}

describe('messages server', () => {
  it('观后信必收、参与未读与revision，消息已读及全部已读连接信件状态', async () => {
    mockGetPublishedAnnouncements.mockResolvedValue([]);
    mockGetUserMessageState.mockResolvedValue({
      mutedKinds: [
        'tracking-update',
        'follow-review',
        'review-reply',
        'new-follower',
        'review-like',
      ],
    });
    const empty = await getUserMessageSummary('reader');
    const capsule = {
      id: 'letter',
      title: '作品',
      year: '2026',
      cover: '',
      source: '',
      videoId: '',
      content: '正文',
      ratingThen: 8,
      ratingNow: 9,
      createdAt: 100,
      deliverAt: 200,
      openedAt: null,
    };
    const message = {
      ...capsule,
      id: 'time-capsule:letter',
      capsuleId: 'letter',
      writtenAt: 100,
      createdAt: 200,
      type: 'time-capsule',
    };
    mockGetCapsuleMessages.mockResolvedValue({ items: [message], total: 1 });
    const summary = await getUserMessageSummary('reader');
    expect(summary.unreadCount).toBe(empty.unreadCount + 1);
    expect(summary.revision).not.toBe(empty.revision);
    expect(summary.latestUnread).toMatchObject({
      type: 'time-capsule',
      title: '作品',
    });
    expect((await getUserMessagePage('reader', 20)).items).toContainEqual(
      message,
    );
    mockOpenCapsule.mockResolvedValue({ ...capsule, openedAt: 300 });
    expect(await readUserMessage('reader', message.id)).toMatchObject({
      message: { capsuleId: 'letter', openedAt: 300 },
    });
    await readAllUserMessages('reader');
    expect(mockReadAllCapsules).toHaveBeenCalledWith(
      'reader',
      expect.any(Number),
    );
  });

  it('merges recap notifications into follow counts, revision and the shared read state', async () => {
    mockGetPublishedAnnouncements.mockResolvedValue([]);
    mockGetUnreadTrackingPlayRecordPage.mockResolvedValue({
      items: {},
      total: 0,
      nextCursor: null,
    });
    const recap = {
      id: 'follow-recap:AbCdEf012345:2025:1000',
      type: 'follow-recap',
      author: { profileId: 'AbCdEf012345', nickname: '作者', avatarSeed: null },
      year: 2025,
      at: 1000,
      createdAt: 1000,
    };
    mockGetFollowRecapMessages.mockResolvedValue([recap]);
    mockGetFollowRecapMessageCount.mockResolvedValue(1);
    const summary = await getUserMessageSummary('reader');
    expect(summary.followReviewUnreadCount).toBe(1);
    expect(summary.unreadCount).toBe(1);
    expect((await getUserMessagePage('reader', 20)).items).toEqual([recap]);
    expect(await readUserMessage('reader', recap.id)).toEqual({
      message: recap,
    });
    expect(mockUpdateUserMessageState).toHaveBeenCalledWith('reader', {
      followReview: { id: recap.id, createdAt: 1000 },
    });
    mockGetFollowRecapMessages.mockResolvedValue([
      { ...recap, id: 'follow-recap:AbCdEf012345:2025:2000' },
    ]);
    expect((await getUserMessageSummary('reader')).revision).not.toBe(
      summary.revision,
    );
    mockGetUserMessageState.mockResolvedValue({
      mutedKinds: ['follow-review'],
    });
    expect(
      (await getUserMessageSummary('reader')).followReviewUnreadCount,
    ).toBe(0);
    expect(await readUserMessage('reader', recap.id)).toBeNull();
  });
  it('preserves concurrent recap reads and compresses mixed follow IDs', () => {
    const id = 'follow-recap:AbCdEf012345:2025:300';
    const state = mergeUserMessageState(
      { followReviewReadIds: [id] },
      { followReviewReadAt: 200 },
    );
    expect(state.followReviewReadIds).toEqual([id]);
    const compressed = mergeUserMessageState({}, { followReviewReadAt: 400 });
    expect(
      mergeUserMessageState(compressed, {
        followReview: { id, createdAt: 300 },
      }).followReviewReadIds,
    ).toEqual([]);
    let many: UserMessageState = {};
    for (let at = 1; at <= 201; at++)
      many = mergeUserMessageState(many, {
        followReview: {
          id: `follow-recap:AbCdEf012345:2025:${at}`,
          createdAt: at,
        },
      });
    expect(many.followReviewReadAt).toBe(1);
    expect(many.followReviewReadIds).toHaveLength(200);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCapsuleMessages.mockResolvedValue({ items: [], total: 0 });
    mockOpenCapsule.mockResolvedValue(null);
    mockReadAllCapsules.mockResolvedValue(undefined);
    mockGetFavoriteUpdateMessagePage.mockResolvedValue({ items: [], total: 0 });
    mockGetFavorite.mockResolvedValue(null);
    mockReadFavoriteUpdate.mockResolvedValue(undefined);
    mockHasPlaybackAnnualActivity.mockResolvedValue(false);
    mockGetSocialNotifications.mockResolvedValue([]);
    mockGetSocialNotificationCount.mockResolvedValue(0);
    mockGetReviewReplyMessages.mockResolvedValue([]);
    mockGetReviewReplyMessageCount.mockResolvedValue(0);
    mockGetUserNoticeMessages.mockResolvedValue([]);
    mockGetUserNoticeCount.mockResolvedValue(0);
    mockGetFollowRecapMessages.mockResolvedValue([]);
    mockGetFollowRecapMessageCount.mockResolvedValue(0);
    mockGetFollowReviewMessages.mockResolvedValue([]);
    mockGetFollowReviewMessageCount.mockResolvedValue(0);
    mockGetPublishedAnnouncements.mockResolvedValue([announcementRow]);
    mockGetAnnouncement.mockResolvedValue(announcementRow);
    mockGetAllPlayRecords.mockResolvedValue({
      'source-a+video-1': updatedRecord,
      'source-b+video-2': {
        ...updatedRecord,
        title: '已取消追更',
        tracking_enabled: false,
      },
    });
    mockGetUnreadTrackingPlayRecordPage.mockResolvedValue({
      items: { 'source-a+video-1': updatedRecord },
      total: 1,
      nextCursor: null,
    });
    mockGetUserMessageState.mockResolvedValue({});
    mockUpdateUserMessageState.mockResolvedValue(undefined);
    mockGetPlayRecord.mockResolvedValue(updatedRecord);
    mockSavePlayRecord.mockResolvedValue(undefined);
    mockSavePlayRecordsByKey.mockResolvedValue(undefined);
  });

  it('收藏与播放同毫秒分页不重漏，摘要和已读使用收藏基线', async () => {
    const { buildFavoriteUpdateMessage } =
      await import('@/features/favorites/lib/favorite-tracking');
    const favorite = { ...updatedRecord, update_detected_at: 4000 };
    const message = buildFavoriteUpdateMessage('source+favorite', favorite)!;
    mockGetPublishedAnnouncements.mockResolvedValue([]);
    mockGetFavoriteUpdateMessagePage.mockResolvedValue({
      items: [message],
      total: 1,
    });
    const first = await getUserMessagePage('reader', 1);
    expect(first.items[0].id).toMatch(/^tracking:/);
    const second = await getUserMessagePage('reader', 1, first.nextCursor);
    expect(second.items).toEqual([message]);
    expect(second.nextCursor).toBeNull();
    expect(mockGetFavoriteUpdateMessagePage).toHaveBeenLastCalledWith(
      'reader',
      2,
      { createdAt: 4000, key: 'tracking:source-a+video-1' },
    );
    mockGetUnreadTrackingPlayRecordPage.mockResolvedValue({
      items: {},
      total: 0,
      nextCursor: null,
    });
    const summary = await getUserMessageSummary('reader');
    expect(summary).toMatchObject({
      trackingUnreadCount: 1,
      unreadCount: 1,
      latestUnreadAt: 4000,
      latestUnread: { title: favorite.title, toEpisodes: 12 },
    });
    mockGetFavorite.mockResolvedValue(favorite);
    mockGetPlayRecord.mockResolvedValue(null);
    expect(await readUserMessage('reader', message.id)).toEqual({ message });
    expect(mockReadFavoriteUpdate).toHaveBeenCalledWith(
      'reader',
      'source+favorite',
      12,
    );
    await readAllUserMessages('reader');
    expect(mockReadFavoriteUpdate).toHaveBeenCalledTimes(2);
    mockGetPlayRecord.mockResolvedValue(updatedRecord);
    expect(await readUserMessage('reader', message.id)).toBeNull();
    mockGetUserMessageState.mockResolvedValue({
      mutedKinds: ['tracking-update'],
    });
    expect((await getUserMessageSummary('reader')).trackingUnreadCount).toBe(0);
    expect(await readUserMessage('reader', message.id)).toBeNull();
  });

  it('管理通知必收并参与未读摘要、联合分页、单条与全部已读', async () => {
    const notice = {
      id: 'user-notice:9000:00000000-0000-4000-8000-000000000001',
      type: 'account-change',
      action: 'set-admin',
      payload: {},
      createdAt: 9000,
    };
    mockGetPublishedAnnouncements.mockResolvedValue([]);
    mockGetUserMessageState.mockResolvedValue({
      mutedKinds: [
        'tracking-update',
        'follow-review',
        'review-reply',
        'new-follower',
        'review-like',
      ],
    });
    mockGetUserNoticeMessages.mockResolvedValue([notice]);
    mockGetUserNoticeCount.mockResolvedValue(1);
    expect(await getUserMessageSummary('reader')).toMatchObject({
      unreadCount: 1,
      latestUnreadAt: 9000,
      latestUnread: { type: 'account-change', noticeText: '你已被设为管理员' },
    });
    expect(await getUserMessagePage('reader', 10)).toMatchObject({
      items: [notice],
      total: 1,
    });
    expect(await readUserMessage('reader', notice.id)).toEqual({
      message: notice,
    });
    expect(mockUpdateUserMessageState).toHaveBeenLastCalledWith('reader', {
      userNotice: { id: notice.id, createdAt: 9000 },
    });
    await readAllUserMessages('reader');
    expect(mockUpdateUserMessageState).toHaveBeenLastCalledWith(
      'reader',
      expect.objectContaining({ userNoticeReadAt: expect.any(Number) }),
    );
  });

  it('管理消息游标之后保留同毫秒的追更消息', async () => {
    const { encodeCursorPosition } =
      await import('@/lib/message-cursor.server');
    const before = encodeCursorPosition(
      9000,
      'user-notice:00000000-0000-4000-8000-000000000001',
    );
    await getUserMessagePage('reader', 10, before);
    expect(mockGetUnreadTrackingPlayRecordPage).toHaveBeenLastCalledWith(
      'reader',
      11,
      9000,
      '￿',
    );
  });

  it('静音类型跳过查询并排除列表、计数与摘要 revision', async () => {
    mockGetUserMessageState.mockResolvedValue({
      mutedKinds: [
        'tracking-update',
        'follow-review',
        'review-reply',
        'new-follower',
        'review-like',
      ],
    });
    const summary = await getUserMessageSummary('reader');
    expect(summary).toMatchObject({
      latestUnreadAt: 5000,
      latestUnread: { type: 'announcement', createdAt: 5000 },
      unreadCount: 1,
      trackingUnreadCount: 0,
      followReviewUnreadCount: 0,
      reviewReplyUnreadCount: 0,
      newFollowerUnreadCount: 0,
      reviewLikeUnreadCount: 0,
    });
    expect(
      (await getUserMessagePage('reader', 20)).items.map((item) => item.type),
    ).toEqual(['announcement']);
    expect(mockGetUnreadTrackingPlayRecordPage).not.toHaveBeenCalled();
    expect(mockGetFollowReviewMessages).not.toHaveBeenCalled();
    expect(mockGetReviewReplyMessages).not.toHaveBeenCalled();
    expect(mockGetSocialNotifications).not.toHaveBeenCalled();
    expect(mockGetSocialNotificationCount).not.toHaveBeenCalled();
    mockGetSocialNotificationCount.mockResolvedValue(100);
    expect((await getUserMessageSummary('reader')).revision).toBe(
      summary.revision,
    );
    expect(await readUserMessage('reader', 'new-follower:any')).toBeNull();
  });

  it('摘要取最新点赞事件的时间与轻量信息，取消点赞仅改变 revision', async () => {
    const like = {
      id: 'review-like:latest',
      type: 'review-like',
      latestLiker: {
        profileId: 'Reader000001',
        nickname: '读者',
        avatarSeed: null,
      },
      likeCount: 2,
      review: { profileId: 'Author000001', title_norm: 'work', year: '' },
      title: '作品',
      year: '',
      cover: '',
      createdAt: 9000,
    };
    mockGetSocialNotifications.mockImplementation(async (kind) =>
      kind === 'review-like' ? [like] : [],
    );
    mockGetSocialNotificationCount.mockImplementation(async (kind) =>
      kind === 'review-like' ? 1 : 0,
    );
    const before = await getUserMessageSummary('author');
    expect(before.latestUnreadAt).toBe(9000);
    expect(before.latestUnread).toEqual({
      type: 'review-like',
      createdAt: 9000,
      nickname: '读者',
      title: '作品',
    });
    like.likeCount = 1;
    const after = await getUserMessageSummary('author');
    expect(after.revision).not.toBe(before.revision);
    expect(after.latestUnreadAt).toBe(before.latestUnreadAt);
    mockGetUserMessageState.mockResolvedValue({ mutedKinds: ['review-like'] });
    const muted = await getUserMessageSummary('author');
    expect(muted.latestUnreadAt).toBe(5000);
    expect(muted.latestUnread?.type).toBe('announcement');
    mockGetPublishedAnnouncements.mockResolvedValue([]);
    mockGetUnreadTrackingPlayRecordPage.mockResolvedValue({
      items: {},
      total: 0,
      nextCursor: null,
    });
    expect(await getUserMessageSummary('author')).toMatchObject({
      latestUnreadAt: 0,
      latestUnread: null,
    });
  });

  it('新粉丝与点赞参与摘要、混排、单条及全部已读', async () => {
    const follower = {
      id: 'new-follower:opaque',
      type: 'new-follower',
      follower: {
        profileId: 'Reader000001',
        nickname: '读者',
        avatarSeed: null,
      },
      createdAt: 8000,
    };
    const like = {
      id: 'review-like:opaque',
      type: 'review-like',
      latestLiker: follower.follower,
      likeCount: 2,
      review: { profileId: 'Author000001', title_norm: 'work', year: '' },
      title: '作品',
      year: '',
      cover: '',
      createdAt: 7000,
    };
    mockGetSocialNotifications.mockImplementation(async (kind) =>
      kind === 'new-follower' ? [follower] : [like],
    );
    mockGetSocialNotificationCount.mockResolvedValue(1);
    expect(await getUserMessageSummary('author')).toMatchObject({
      unreadCount: 4,
      newFollowerUnreadCount: 1,
      reviewLikeUnreadCount: 1,
    });
    expect(
      (await getUserMessagePage('author', 3)).items.map((item) => item.type),
    ).toEqual(['announcement', 'new-follower', 'review-like']);
    expect((await readUserMessage('author', follower.id))?.message).toEqual(
      follower,
    );
    expect((await readUserMessage('author', like.id))?.message).toEqual(like);
    expect(mockUpdateUserMessageState).toHaveBeenCalledWith('author', {
      newFollower: { id: follower.id, createdAt: 8000 },
    });
    expect(mockUpdateUserMessageState).toHaveBeenCalledWith('author', {
      reviewLike: { id: like.id, createdAt: 7000 },
    });
    mockGetUnreadTrackingPlayRecordPage.mockResolvedValue({
      items: {},
      total: 0,
      nextCursor: null,
    });
    await readAllUserMessages('author');
    expect(mockUpdateUserMessageState).toHaveBeenLastCalledWith(
      'author',
      expect.objectContaining({
        newFollowerReadAt: expect.any(Number),
        reviewLikeReadAt: expect.any(Number),
      }),
    );
  });

  it('回复参与摘要、混排分页和单条已读', async () => {
    const reply = {
      id: 'review-reply:7000:00000000-0000-4000-8000-000000000001',
      type: 'review-reply',
      author: { profileId: 'Reader000001', nickname: '读者', avatarSeed: null },
      title: '作品',
      year: '2026',
      cover: '',
      content: '回复',
      createdAt: 7000,
    };
    mockGetReviewReplyMessages.mockResolvedValue([reply]);
    mockGetReviewReplyMessageCount.mockResolvedValue(2);
    const summary = await getUserMessageSummary('author');
    expect(summary).toMatchObject({
      unreadCount: 4,
      reviewReplyUnreadCount: 2,
    });
    const page = await getUserMessagePage('author', 2);
    expect(page.items.map((item) => item.type)).toEqual([
      'announcement',
      'review-reply',
    ]);
    expect((await readUserMessage('author', reply.id))?.message).toEqual(reply);
    expect(mockUpdateUserMessageState).toHaveBeenCalledWith('author', {
      reviewReply: { id: reply.id, createdAt: 7000 },
    });
    mockGetReviewReplyMessageCount.mockResolvedValue(3);
    expect((await getUserMessageSummary('author')).revision).not.toBe(
      summary.revision,
    );
  });

  it('merges followed reviews with tracking, counts them and reads individual activity', async () => {
    const followed = {
      id: 'follow-review:encoded',
      type: 'follow-review',
      author: { profileId: 'AbCdEf012345', nickname: 'Alice' },
      title: 'Work',
      year: '2026',
      cover: '',
      rating: 8,
      createdAt: 6000,
    };
    mockGetFollowReviewMessages.mockResolvedValue([followed]);
    mockGetFollowReviewMessageCount.mockResolvedValue(1);
    const page = await getUserMessagePage('reader', 2);
    expect(page.items.map((item) => item.type)).toEqual([
      'announcement',
      'follow-review',
    ]);
    expect(page.nextCursor).not.toBeNull();
    const next = await getUserMessagePage('reader', 2, page.nextCursor);
    expect(next.items.map((item) => item.type)).toEqual(['tracking-update']);
    const summary = await getUserMessageSummary('reader');
    expect(summary).toMatchObject({
      unreadCount: 3,
      followReviewUnreadCount: 1,
    });
    expect(await readUserMessage('reader', followed.id)).toEqual({
      message: followed,
    });
    expect(mockUpdateUserMessageState).toHaveBeenCalledWith(
      'reader',
      expect.objectContaining({
        followReview: { id: followed.id, createdAt: followed.createdAt },
      }),
    );
    mockGetFollowReviewMessages.mockResolvedValue([
      { ...followed, id: 'follow-review:changed' },
    ]);
    expect((await getUserMessageSummary('reader')).revision).not.toBe(
      summary.revision,
    );
  });

  it('bounds individual activity read ids and advances the read-all watermark', async () => {
    const followed = {
      id: 'follow-review:latest',
      type: 'follow-review',
      author: { profileId: 'AbCdEf012345', nickname: null },
      title: 'Work',
      year: '',
      cover: '',
      rating: null,
      createdAt: 6000,
    };
    mockGetFollowReviewMessages.mockResolvedValue([followed]);
    mockGetFollowReviewMessageCount.mockResolvedValue(1);
    mockGetUserMessageState.mockResolvedValue({
      followReviewReadIds: Array.from(
        { length: 200 },
        (_, i) => `follow-review:${i}`,
      ),
    });
    await readUserMessage('reader', followed.id);
    const saved = mockUpdateUserMessageState.mock.calls[0][1];
    expect(saved).toEqual({
      followReview: { id: followed.id, createdAt: followed.createdAt },
    });
    mockGetUnreadTrackingPlayRecordPage.mockResolvedValue({
      items: {},
      total: 0,
      nextCursor: null,
    });
    await readAllUserMessages('reader');
    expect(mockUpdateUserMessageState).toHaveBeenLastCalledWith(
      'reader',
      expect.objectContaining({
        followReviewReadAt: expect.any(Number),
      }),
    );
  });

  it('continues tracking after a follow cursor even when newer tracking fills the query limit', async () => {
    mockGetPublishedAnnouncements.mockResolvedValue([]);
    const followed = {
      id: 'follow-review:cursor',
      type: 'follow-review',
      author: { profileId: 'AbCdEf012345', nickname: null },
      title: 'Work',
      year: '',
      cover: '',
      rating: null,
      createdAt: 3000,
    };
    mockGetFollowReviewMessages.mockResolvedValue([followed]);
    mockGetFollowReviewMessageCount.mockResolvedValue(1);
    const records = [5000, 4000, 2000, 1000].map((time) => ({
      ...updatedRecord,
      update_detected_at: time,
    }));
    mockGetUnreadTrackingPlayRecordPage.mockImplementation(
      (_user, limit, time, key) => {
        const remaining =
          time !== undefined && key
            ? records.filter((record) => record.update_detected_at! < time)
            : records;
        return Promise.resolve({
          items: Object.fromEntries(
            remaining
              .slice(0, limit)
              .map((record) => [`source+${record.update_detected_at}`, record]),
          ),
          total: 4,
          nextCursor: remaining.length > limit ? 'more' : null,
        });
      },
    );
    const { encodeCursor } = require('@/lib/message-cursor.server');
    const page = await getUserMessagePage('reader', 1, encodeCursor(followed));
    expect(page.items).toHaveLength(1);
    expect(page.items[0].createdAt).toBe(2000);
  });

  it('uses a bounded latest query and independent count for follow revisions', async () => {
    mockGetFollowReviewMessageCount.mockResolvedValue(300);
    const before = await getUserMessageSummary('reader');
    expect(before.followReviewUnreadCount).toBe(300);
    expect(mockGetFollowReviewMessages).toHaveBeenLastCalledWith(
      'reader',
      0,
      [],
      expect.any(Number),
      { limit: 1 },
    );
    mockGetFollowReviewMessageCount.mockResolvedValue(301);
    const after = await getUserMessageSummary('reader');
    expect(after.revision).not.toBe(before.revision);
    const page = await getUserMessagePage('reader', 20);
    expect(page.total).toBe(303);
    expect(mockGetFollowReviewMessages).toHaveBeenLastCalledWith(
      'reader',
      0,
      [],
      expect.any(Number),
      { limit: 21, before: null },
    );
  });

  it('rejects old follow cursors explicitly and keeps tracking cursors compatible', async () => {
    const cursor = (key: string) =>
      Buffer.from(JSON.stringify({ createdAt: 3000, key })).toString(
        'base64url',
      );
    await expect(
      getUserMessagePage('reader', 20, cursor('follow-review:old')),
    ).rejects.toThrow('消息分页已更新');
    await expect(
      getUserMessagePage('reader', 20, cursor('tracking:source+id')),
    ).resolves.toHaveProperty('items');
  });

  it('bounds read IDs by a monotonic watermark including timestamp ties', () => {
    const id = (time: number, title = 'work') =>
      `follow-review:${Buffer.from(JSON.stringify(['AbCdEf012345', title, '', time])).toString('base64url')}`;
    let state: UserMessageState = {};
    for (let time = 1; time <= 205; time++)
      state = mergeUserMessageState(state, {
        followReview: { id: id(time), createdAt: time },
      });
    expect(state.followReviewReadAt).toBe(5);
    expect(state.followReviewReadIds).toHaveLength(200);
    state = mergeUserMessageState(state, {
      followReview: { id: id(1), createdAt: 1 },
    });
    expect(state.followReviewReadIds).not.toContain(id(1));
    state = {};
    for (let i = 0; i <= 200; i++)
      state = mergeUserMessageState(state, {
        followReview: { id: id(1000, `work-${i}`), createdAt: 1000 },
      });
    expect(state).toMatchObject({
      followReviewReadAt: 1000,
      followReviewReadIds: [],
    });
  });

  it('places the unread announcement first and excludes disabled tracking', async () => {
    const page = await getUserMessagePage('demo', 20);

    expect(page.total).toBe(2);
    expect(page.items.map((message) => message.type)).toEqual([
      'announcement',
      'tracking-update',
    ]);
    expect(page.items[0]).toMatchObject({
      id: ANNOUNCEMENT_ID,
      content: '维护完成，欢迎回来。',
    });
    expect(page.items[1]).toMatchObject({
      title: '示例剧集',
      fromEpisodes: 10,
      toEpisodes: 12,
    });
  });

  it('does not return an announcement after that version is read', async () => {
    mockGetUserMessageState.mockResolvedValue({
      announcementReadIds: [ANNOUNCEMENT_ID],
    });

    const summary = await getUserMessageSummary('demo');

    expect(summary.unreadCount).toBe(1);
    expect(summary.announcement).toBeNull();
    expect(summary.latestTracking?.type).toBe('tracking-update');
    expect(mockGetUnreadTrackingPlayRecordPage).toHaveBeenCalledWith(
      'demo',
      1,
      undefined,
      undefined,
    );
    expect(mockGetAllPlayRecords).not.toHaveBeenCalled();
  });

  it('exposes the announcement and the latest tracking separately', async () => {
    const summary = await getUserMessageSummary('demo');

    expect(summary.unreadCount).toBe(2);
    expect(summary.trackingUnreadCount).toBe(1);
    expect(summary.announcement?.id).toBe(ANNOUNCEMENT_ID);
    expect(summary.latestTracking).toMatchObject({
      title: '示例剧集',
      toEpisodes: 12,
    });
  });

  it('changes the revision when only the unread count grows', async () => {
    const before = await getUserMessageSummary('demo');

    mockGetUnreadTrackingPlayRecordPage.mockResolvedValue({
      items: { 'source-a+video-1': updatedRecord },
      total: 4,
      nextCursor: null,
    });
    const after = await getUserMessageSummary('demo');

    expect(after.latestTracking?.id).toBe(before.latestTracking?.id);
    expect(after.revision).not.toBe(before.revision);
  });

  it('reflects a read announcement in the next summary', async () => {
    usePersistedUserMessageState();
    const before = await getUserMessageSummary('demo');
    expect(before.announcement?.id).toBe(ANNOUNCEMENT_ID);

    await readUserMessage('demo', ANNOUNCEMENT_ID);
    const after = await getUserMessageSummary('demo');

    expect(after.announcement).toBeNull();
    expect(after.unreadCount).toBe(1);
  });

  it('marks an announcement version as read', async () => {
    const result = await readUserMessage('demo', ANNOUNCEMENT_ID);

    expect(result?.message.type).toBe('announcement');
    expect(mockUpdateUserMessageState).toHaveBeenCalledWith('demo', {
      announcement: { id: ANNOUNCEMENT_ID, createdAt: 5_000 },
    });
  });

  it('pins every unread announcement, newest first, and counts each one', async () => {
    mockGetPublishedAnnouncements.mockResolvedValue([
      { ...announcementRow, id: 'a3', publishedAt: 6_000 },
      announcementRow,
    ]);
    mockGetUserMessageState.mockResolvedValue({ announcementReadAt: 5_000 });
    const hidden = await getUserMessagePage('demo', 20);
    expect(hidden.items.map((message) => message.id)).toEqual([
      'announcement:6000:a3',
      expect.stringMatching(/^tracking:/),
    ]);

    mockGetUserMessageState.mockResolvedValue({});
    const page = await getUserMessagePage('demo', 20);
    expect(page.total).toBe(3);
    expect(page.items.slice(0, 2).map((message) => message.id)).toEqual([
      'announcement:6000:a3',
      ANNOUNCEMENT_ID,
    ]);
    expect(mockGetPublishedAnnouncements).toHaveBeenLastCalledWith({
      since: expect.any(Number),
      limit: expect.any(Number),
    });
  });

  it('rejects reading a withdrawn or re-pushed announcement', async () => {
    mockGetAnnouncement.mockResolvedValue({
      ...announcementRow,
      publishedAt: null,
    });
    await expect(readUserMessage('demo', ANNOUNCEMENT_ID)).resolves.toBeNull();
    mockGetAnnouncement.mockResolvedValue({
      ...announcementRow,
      publishedAt: 9_000,
    });
    await expect(readUserMessage('demo', ANNOUNCEMENT_ID)).resolves.toBeNull();
    expect(mockUpdateUserMessageState).not.toHaveBeenCalled();
  });

  it('read-all advances the announcement watermark', async () => {
    usePersistedUserMessageState();
    mockGetUnreadTrackingPlayRecordPage.mockResolvedValue({
      items: {},
      total: 0,
      nextCursor: null,
    });
    await readAllUserMessages('demo');
    const summary = await getUserMessageSummary('demo');
    expect(summary.announcement).toBeNull();
  });

  it('pages announcement history with a published-at cursor', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      ...announcementRow,
      id: `h${index}`,
      publishedAt: 10_000 - index,
    }));
    mockGetPublishedAnnouncements.mockResolvedValueOnce(rows);
    const first = await getAnnouncementHistory();
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBe('9981:h19');
    expect(mockGetPublishedAnnouncements).toHaveBeenLastCalledWith({
      limit: 21,
    });

    mockGetPublishedAnnouncements.mockResolvedValueOnce(rows.slice(20));
    const second = await getAnnouncementHistory(first.nextCursor);
    expect(second).toEqual({
      items: [expect.objectContaining({ id: 'announcement:9980:h20' })],
      nextCursor: null,
    });
    expect(mockGetPublishedAnnouncements).toHaveBeenLastCalledWith({
      before: { publishedAt: 9981, id: 'h19' },
      limit: 21,
    });
    await expect(getAnnouncementHistory('bad')).rejects.toThrow(
      '公告列表已更新',
    );
  });

  it('reads only through the episode represented by the message', async () => {
    const page = await getUserMessagePage('demo', 20);
    const message = page.items.find((item) => item.type === 'tracking-update');
    expect(message).toBeDefined();
    mockGetPlayRecord.mockResolvedValue({
      ...updatedRecord,
      total_episodes: 13,
    });

    const result = await readUserMessage('demo', message!.id);

    expect(result?.updatedRecord?.record).toMatchObject({
      total_episodes: 13,
      update_baseline_episodes: 12,
    });
    expect(mockSavePlayRecord).toHaveBeenCalledWith(
      'demo',
      'source-a',
      'video-1',
      expect.objectContaining({ update_baseline_episodes: 12 }),
    );
  });

  it('marks tracking updates in batches without reading every record separately', async () => {
    mockGetUnreadTrackingPlayRecordPage
      .mockResolvedValueOnce({
        items: { 'source-a+video-1': updatedRecord },
        total: 1,
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        items: {},
        total: 0,
        nextCursor: null,
      });

    const result = await readAllUserMessages('demo');

    expect(result.updatedRecords['source-a+video-1']).toMatchObject({
      update_baseline_episodes: 12,
    });
    expect(mockSavePlayRecordsByKey).toHaveBeenCalledWith('demo', {
      'source-a+video-1': expect.objectContaining({
        update_baseline_episodes: 12,
      }),
    });
    expect(mockGetPlayRecord).not.toHaveBeenCalled();
  });
});

describe('annual report messages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCapsuleMessages.mockResolvedValue({ items: [], total: 0 });
    mockOpenCapsule.mockResolvedValue(null);
    mockReadAllCapsules.mockResolvedValue(undefined);
    mockGetFavoriteUpdateMessagePage.mockResolvedValue({ items: [], total: 0 });
    mockGetFavorite.mockResolvedValue(null);
    mockReadFavoriteUpdate.mockResolvedValue(undefined);
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-12-19T16:00:00Z'));
    usePersistedUserMessageState();
    mockHasPlaybackAnnualActivity.mockResolvedValue(true);
    mockGetPublishedAnnouncements.mockResolvedValue([]);
    mockGetUserNoticeMessages.mockResolvedValue([]);
    mockGetUserNoticeCount.mockResolvedValue(0);
    mockGetFollowRecapMessages.mockResolvedValue([]);
    mockGetFollowRecapMessageCount.mockResolvedValue(0);
    mockGetFollowReviewMessages.mockResolvedValue([]);
    mockGetFollowReviewMessageCount.mockResolvedValue(0);
    mockGetReviewReplyMessages.mockResolvedValue([]);
    mockGetReviewReplyMessageCount.mockResolvedValue(0);
    mockGetSocialNotifications.mockResolvedValue([]);
    mockGetSocialNotificationCount.mockResolvedValue(0);
    mockGetUnreadTrackingPlayRecordPage.mockResolvedValue({
      items: {},
      total: 0,
      nextCursor: null,
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('opens at local midnight, affects revision and queries only during the window', async () => {
    const closed = await getUserMessageSummary('reader', 'UTC');
    expect(closed.unreadCount).toBe(0);
    expect(mockHasPlaybackAnnualActivity).not.toHaveBeenCalled();
    const open = await getUserMessageSummary('reader', 'Asia/Shanghai');
    expect(open.unreadCount).toBe(1);
    expect(open.annualReport).toEqual({
      id: 'annual-report:2026',
      type: 'annual-report',
      year: 2026,
      createdAt: Date.parse('2026-12-19T16:00:00Z'),
    });
    expect(open.revision).not.toBe(closed.revision);
    expect(mockHasPlaybackAnnualActivity).toHaveBeenCalledWith(
      'reader',
      Date.parse('2025-12-31T16:00:00Z'),
      Date.parse('2026-12-31T16:00:00Z'),
    );
    mockHasPlaybackAnnualActivity.mockClear();
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2027-03-01T00:00:00Z'));
    expect((await getUserMessageSummary('reader')).unreadCount).toBe(0);
    expect(mockHasPlaybackAnnualActivity).not.toHaveBeenCalled();
  });

  it('requires viewing activity and rejects unavailable annual identifiers', async () => {
    expect(
      await readUserMessage('reader', 'annual-report:2025', 'Asia/Shanghai'),
    ).toBeNull();
    mockHasPlaybackAnnualActivity.mockResolvedValue(false);
    expect(
      (await getUserMessagePage('reader', 20, null, 'Asia/Shanghai')).items,
    ).toEqual([]);
    expect(
      await readUserMessage('reader', 'annual-report:2026', 'Asia/Shanghai'),
    ).toBeNull();
    expect(mockUpdateUserMessageState).not.toHaveBeenCalled();
  });

  it('persists annual read across timezones and skips later eligibility queries', async () => {
    await readUserMessage('reader', 'annual-report:2026', 'Asia/Shanghai');
    mockHasPlaybackAnnualActivity.mockClear();
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2027-02-28T10:00:00Z'));
    expect(
      (await getUserMessageSummary('reader', 'America/New_York')).unreadCount,
    ).toBe(0);
    expect(mockHasPlaybackAnnualActivity).not.toHaveBeenCalled();
    expect(await mockGetUserMessageState()).toMatchObject({
      annualReportReadYear: 2026,
    });
  });

  it('read-all confirms annual messages even when optional kinds are muted', async () => {
    await mockUpdateUserMessageState('reader', {
      notificationSettings: {
        mutedKinds: [
          'tracking-update',
          'follow-review',
          'review-reply',
          'new-follower',
          'review-like',
        ],
        now: Date.now(),
      },
    });
    expect(
      (await getUserMessageSummary('reader', 'Asia/Shanghai')).unreadCount,
    ).toBe(1);
    await readAllUserMessages('reader', 'Asia/Shanghai');
    expect(
      (await getUserMessageSummary('reader', 'Asia/Shanghai')).unreadCount,
    ).toBe(0);
    expect(mockGetUnreadTrackingPlayRecordPage).not.toHaveBeenCalled();
  });

  it('pins annual messages on the first page without consuming the feed cursor', async () => {
    mockGetUnreadTrackingPlayRecordPage.mockResolvedValue({
      items: { 'source-a+video-1': updatedRecord },
      total: 1,
      nextCursor: null,
    });
    const first = await getUserMessagePage('reader', 1, null, 'Asia/Shanghai');
    expect(first.items.map((message) => message.id)).toEqual([
      'annual-report:2026',
    ]);
    expect(first.total).toBe(2);
    expect(first.nextCursor).not.toBeNull();
    const next = await getUserMessagePage(
      'reader',
      1,
      first.nextCursor,
      'Asia/Shanghai',
    );
    expect(next.items.map((message) => message.type)).toEqual([
      'tracking-update',
    ]);
    expect(next.nextCursor).toBeNull();
  });
});
