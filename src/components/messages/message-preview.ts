import {
  UserMessage,
  UserMessagePage,
  UserMessageSummary,
} from '@/lib/message-types';

export type MessagePreviewMode =
  | 'panel'
  | 'announcement'
  | 'tracking'
  | 'follow-review'
  | 'all';

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
    value === 'follow-review' ||
    value === 'all'
    ? value
    : null;
}

const previewFollowReviews = [
  { nickname: '光影旅人', title: '漫长的季节', year: '2023', rating: 9 },
  { nickname: '深夜放映员', title: '星际远征', year: '2024', rating: 7.5 },
  { nickname: null, title: '城市边缘', year: '2022', rating: null },
];

export function getMessagePreviewPage(): UserMessagePage {
  const now = Date.now();
  const tracking: UserMessage[] = previewTrackingTitles.map((title, index) => ({
    id: `tracking:preview+${index}:${index + 2}:${index + 3}`,
    type: 'tracking-update',
    recordKey: `preview+${index}`,
    source: 'preview',
    videoId: String(index),
    title,
    year: '2024',
    sourceName: '预览源站',
    cover: `https://picsum.photos/seed/icetv-message-${index}/96/144`,
    fromEpisodes: index + 2,
    toEpisodes: index + 3,
    createdAt: now - index * 3_600_000,
  }));
  const followReviews: UserMessage[] = previewFollowReviews.map(
    (review, index) => ({
      id: `follow-review:preview+${index}`,
      type: 'follow-review',
      review: {
        profileId: `previewUser${index + 1}`,
        title_norm: review.title,
        year: review.year,
      },
      author: {
        profileId: `previewUser${index + 1}`,
        nickname: review.nickname,
        avatarSeed: null,
      },
      title: review.title,
      year: review.year,
      cover: '',
      rating: review.rating,
      createdAt: now - index * 5_400_000 - 1_800_000,
    }),
  );
  const updates = [...tracking, ...followReviews].sort(
    (a, b) => b.createdAt - a.createdAt,
  );

  return {
    items: [
      {
        id: 'announcement:preview',
        type: 'announcement',
        content: '这是开发环境的消息面板预览公告，不会写入真实消息状态。',
        createdAt: now,
      },
      ...updates,
    ],
    total: updates.length + 1,
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
    reviewReplyUnreadCount: 0,
    newFollowerUnreadCount: 0,
    reviewLikeUnreadCount: 0,
    followReviewUnreadCount: page.items.filter(
      (message) => message.type === 'follow-review',
    ).length,
    revision: 'message-preview',
    announcement:
      page.items.find((message) => message.type === 'announcement') || null,
    latestTracking: tracking[0] || null,
  };
}

export function getMessagePreviewToast(mode: MessagePreviewMode): string {
  if (mode === 'announcement') return '有一条新公告';
  if (mode === 'tracking') return '《测试剧集：最新一集》已更新至第 3 集';
  if (mode === 'follow-review') return '关注的人发布了新评价';
  return `${getMessagePreviewPage().total} 条新消息`;
}
