import { UserMessagePage, UserMessageSummary } from '@/lib/message-types';

export type MessagePreviewMode = 'panel' | 'announcement' | 'tracking' | 'all';

const previewTrackingTitles = [
  '测试剧集：最新一集',
  '星际远征',
  '夏日重现',
  '城市边缘',
  '漫长的季节',
  '深海回声',
  '夜航日志',
];

export function getMessagePreviewMode(): MessagePreviewMode | null {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') {
    return null;
  }
  const value = new URLSearchParams(window.location.search).get(
    'messagePreview',
  );
  return value === 'panel' ||
    value === 'announcement' ||
    value === 'tracking' ||
    value === 'all'
    ? value
    : null;
}

export function getMessagePreviewPage(): UserMessagePage {
  const now = Date.now();
  const tracking = previewTrackingTitles.map((title, index) => ({
    id: `tracking:preview+${index}:${index + 2}:${index + 3}`,
    type: 'tracking-update' as const,
    recordKey: `preview+${index}`,
    source: 'preview',
    videoId: String(index),
    title,
    sourceName: '预览源站',
    cover: `https://picsum.photos/seed/icetv-message-${index}/96/144`,
    fromEpisodes: index + 2,
    toEpisodes: index + 3,
    createdAt: now - index * 3_600_000,
  }));

  return {
    items: [
      {
        id: 'announcement:preview',
        type: 'announcement',
        content: '这是开发环境的消息面板预览公告，不会写入真实消息状态。',
        createdAt: now,
      },
      ...tracking,
    ],
    total: tracking.length + 1,
    nextCursor: null,
  };
}

export function getMessagePreviewSummary(
  page: UserMessagePage,
): UserMessageSummary {
  const tracking = page.items.filter(
    (message) => message.type === 'tracking-update',
  );
  return {
    unreadCount: page.total,
    trackingUnreadCount: tracking.length,
    revision: 'message-preview',
    announcement:
      page.items.find((message) => message.type === 'announcement') || null,
    latestTracking: tracking[0] || null,
  };
}

export function getMessagePreviewToast(mode: MessagePreviewMode): string {
  if (mode === 'announcement') return '有一条新公告';
  if (mode === 'tracking') return '《测试剧集：最新一集》已更新至第 3 集';
  return '8 条新消息';
}
