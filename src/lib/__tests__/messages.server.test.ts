/** @jest-environment node */

import type { AdminConfig } from '@/types/admin';

const mockGetConfigForRead = jest.fn();
const mockGetAllPlayRecords = jest.fn();
const mockGetUnreadTrackingPlayRecordPage = jest.fn();
const mockGetUserMessageState = jest.fn();
const mockSetUserMessageState = jest.fn();
const mockGetPlayRecord = jest.fn();
const mockSavePlayRecord = jest.fn();
const mockSavePlayRecordsByKey = jest.fn();

jest.mock('@/lib/config', () => ({
  getConfigForRead: (...args: unknown[]) => mockGetConfigForRead(...args),
}));

jest.mock('@/lib/db', () => ({
  db: {
    getAllPlayRecords: (...args: unknown[]) => mockGetAllPlayRecords(...args),
    getUnreadTrackingPlayRecordPage: (...args: unknown[]) =>
      mockGetUnreadTrackingPlayRecordPage(...args),
    getUserMessageState: (...args: unknown[]) =>
      mockGetUserMessageState(...args),
    setUserMessageState: (...args: unknown[]) =>
      mockSetUserMessageState(...args),
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
import type { PlayRecord } from '@/lib/types';

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

describe('messages server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    mockSetUserMessageState.mockResolvedValue(undefined);
    mockGetPlayRecord.mockResolvedValue(updatedRecord);
    mockSavePlayRecord.mockResolvedValue(undefined);
    mockSavePlayRecordsByKey.mockResolvedValue(undefined);
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
    expect(summary.latestMessage?.type).toBe('tracking-update');
    expect(mockGetUnreadTrackingPlayRecordPage).toHaveBeenCalledWith('demo', 1);
    expect(mockGetAllPlayRecords).not.toHaveBeenCalled();
  });

  it('marks an announcement version as read', async () => {
    const result = await readUserMessage('demo', 'announcement:v2');

    expect(result?.message.type).toBe('announcement');
    expect(mockSetUserMessageState).toHaveBeenCalledWith('demo', {
      readAnnouncementId: 'announcement:v2',
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
