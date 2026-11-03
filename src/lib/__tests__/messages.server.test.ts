/** @jest-environment node */

import type { AdminConfig } from '@/types/admin';

const mockGetFollowReviewMessages = jest.fn();
const mockGetConfigForRead = jest.fn();
const mockGetAllPlayRecords = jest.fn();
const mockGetUnreadTrackingPlayRecordPage = jest.fn();
const mockGetUserMessageState = jest.fn();
const mockUpdateUserMessageState = jest.fn();
const mockGetPlayRecord = jest.fn();
const mockSavePlayRecord = jest.fn();
const mockSavePlayRecordsByKey = jest.fn();

jest.mock('@/lib/config', () => ({
  getConfigForRead: (...args: unknown[]) => mockGetConfigForRead(...args),
}));

jest.mock('@/lib/db', () => ({
  db: {
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

const config = {
  SiteConfig: {
    Announcement: '维护完成，欢迎回来。',
    AnnouncementVersion: 'v2',
    AnnouncementPublishedAt: 5_000,
  },
} as AdminConfig;

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
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFollowReviewMessages.mockResolvedValue([]);
    mockGetConfigForRead.mockResolvedValue(config);
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
    mockGetConfigForRead.mockResolvedValue({
      SiteConfig: { Announcement: '' },
    });
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

  it('places the unread announcement first and excludes disabled tracking', async () => {
    const page = await getUserMessagePage('demo', 20);

    expect(page.total).toBe(2);
    expect(page.items.map((message) => message.type)).toEqual([
      'announcement',
      'tracking-update',
    ]);
    expect(page.items[0]).toMatchObject({
      id: 'announcement:v2',
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
      readAnnouncementId: 'announcement:v2',
    });

    const summary = await getUserMessageSummary('demo');

    expect(summary.unreadCount).toBe(1);
    expect(summary.announcement).toBeNull();
    expect(summary.latestTracking?.type).toBe('tracking-update');
    expect(mockGetUnreadTrackingPlayRecordPage).toHaveBeenCalledWith('demo', 1);
    expect(mockGetAllPlayRecords).not.toHaveBeenCalled();
  });

  it('exposes the announcement and the latest tracking separately', async () => {
    const summary = await getUserMessageSummary('demo');

    expect(summary.unreadCount).toBe(2);
    expect(summary.trackingUnreadCount).toBe(1);
    expect(summary.announcement?.id).toBe('announcement:v2');
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
    expect(before.announcement?.id).toBe('announcement:v2');

    await readUserMessage('demo', 'announcement:v2');
    const after = await getUserMessageSummary('demo');

    expect(after.announcement).toBeNull();
    expect(after.unreadCount).toBe(1);
  });

  it('marks an announcement version as read', async () => {
    const result = await readUserMessage('demo', 'announcement:v2');

    expect(result?.message.type).toBe('announcement');
    expect(mockUpdateUserMessageState).toHaveBeenCalledWith('demo', {
      announcement: { id: 'announcement:v2', previousId: undefined },
    });
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
