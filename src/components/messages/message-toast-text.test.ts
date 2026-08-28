import type {
  AnnouncementUserMessage,
  TrackingUpdateUserMessage,
  UserMessageSummary,
} from '@/lib/message-types';

import { buildToastText } from './message-toast-text';

const announcement: AnnouncementUserMessage = {
  id: 'announcement:v2',
  type: 'announcement',
  content: '维护完成。',
  createdAt: 5_000,
};

const tracking: TrackingUpdateUserMessage = {
  id: 'tracking:source-a%2Bvideo-1:10:12',
  type: 'tracking-update',
  recordKey: 'source-a+video-1',
  source: 'source-a',
  videoId: 'video-1',
  title: '示例剧集',
  sourceName: '示例源',
  cover: '/cover.jpg',
  fromEpisodes: 10,
  toEpisodes: 12,
  createdAt: 4_000,
};

function makeSummary(
  overrides: Partial<UserMessageSummary> = {},
): UserMessageSummary {
  return {
    unreadCount: 0,
    trackingUnreadCount: 0,
    revision: 'rev',
    announcement: null,
    latestTracking: null,
    ...overrides,
  };
}

describe('buildToastText', () => {
  it('describes the tracking update when the announcement is unchanged', () => {
    const previous = makeSummary({ unreadCount: 1, announcement });
    const next = makeSummary({
      unreadCount: 2,
      trackingUnreadCount: 1,
      announcement,
      latestTracking: tracking,
    });

    expect(buildToastText(next, previous, 'poll')).toBe(
      '《示例剧集》已更新至第 12 集',
    );
  });

  it('describes the announcement when its version changed', () => {
    const previous = makeSummary({
      unreadCount: 1,
      trackingUnreadCount: 1,
      latestTracking: tracking,
    });
    const next = makeSummary({
      unreadCount: 2,
      trackingUnreadCount: 1,
      announcement,
      latestTracking: tracking,
    });

    expect(buildToastText(next, previous, 'poll')).toBe('有一条新公告');
  });

  it('counts additions when more than one message arrives', () => {
    const previous = makeSummary({ unreadCount: 1, announcement });
    const next = makeSummary({
      unreadCount: 4,
      trackingUnreadCount: 3,
      announcement,
      latestTracking: tracking,
    });

    expect(buildToastText(next, previous, 'poll')).toBe('3 条新消息');
  });

  it('reports the unread total on mount instead of claiming additions', () => {
    const next = makeSummary({
      unreadCount: 6,
      trackingUnreadCount: 5,
      announcement,
      latestTracking: tracking,
    });

    expect(buildToastText(next, null, 'mount')).toBe('6 条未读消息');
  });

  it('describes the only unread message on mount', () => {
    const next = makeSummary({ unreadCount: 1, announcement });

    expect(buildToastText(next, null, 'mount')).toBe('有一条新公告');
  });
});
