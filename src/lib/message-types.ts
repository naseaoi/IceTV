import {
  type UserNoticeMessage,
  isUserNotice,
  userNoticeText,
} from '@/lib/user-notice';
export type MessageNotificationKind =
  | 'tracking-update'
  | 'follow-review'
  | 'review-reply'
  | 'new-follower'
  | 'review-like';
export const MESSAGE_NOTIFICATION_KINDS: readonly MessageNotificationKind[] = [
  'tracking-update',
  'follow-review',
  'review-reply',
  'new-follower',
  'review-like',
];

export interface AnnualReportUserMessage {
  id: string;
  type: 'annual-report';
  year: number;
  createdAt: number;
}

export interface AnnouncementUserMessage {
  id: string;
  type: 'announcement';
  content: string;
  createdAt: number;
}

export interface TrackingUpdateUserMessage {
  id: string;
  type: 'tracking-update';
  recordKey: string;
  source: string;
  videoId: string;
  title: string;
  year: string;
  searchTitle?: string;
  sourceName: string;
  cover: string;
  fromEpisodes: number;
  toEpisodes: number;
  createdAt: number;
}

export interface FollowRecapUserMessage {
  id: string;
  type: 'follow-recap';
  author: import('./types').PublicUserRef;
  year: number;
  at: number;
  createdAt: number;
}

export interface FollowReviewUserMessage {
  id: string;
  type: 'follow-review';
  review: import('./types').ReviewTarget;
  author: import('./types').PublicUserRef;
  title: string;
  year: string;
  cover: string;
  rating: number | null;
  createdAt: number;
}

export interface ReviewReplyUserMessage {
  id: string;
  type: 'review-reply';
  review: import('./types').ReviewTarget;
  replyId: string;
  author: import('./types').PublicUserRef;
  title: string;
  year: string;
  cover: string;
  content: string;
  createdAt: number;
}

export interface NewFollowerUserMessage {
  id: string;
  type: 'new-follower';
  follower: import('./types').PublicUserRef;
  createdAt: number;
}
export interface ReviewLikeUserMessage {
  id: string;
  type: 'review-like';
  latestLiker: import('./types').PublicUserRef;
  likeCount: number;
  review: import('./types').ReviewTarget;
  title: string;
  year: string;
  cover: string;
  createdAt: number;
}
export type UserMessage =
  | import('@/features/time-capsule/types').TimeCapsuleUserMessage
  | UserNoticeMessage
  | AnnualReportUserMessage
  | AnnouncementUserMessage
  | TrackingUpdateUserMessage
  | FollowRecapUserMessage
  | FollowReviewUserMessage
  | ReviewReplyUserMessage
  | NewFollowerUserMessage
  | ReviewLikeUserMessage;

export interface UserMessagePage {
  items: UserMessage[];
  total: number;
  nextCursor: string | null;
}

export interface AnnouncementHistoryPage {
  items: AnnouncementUserMessage[];
  nextCursor: string | null;
}

export interface MessageToastPreview {
  noticeText?: string;
  type: UserMessage['type'];
  createdAt: number;
  nickname?: string | null;
  title?: string;
  year?: number;
  toEpisodes?: number;
}

export function toMessageToastPreview(
  message: UserMessage,
): MessageToastPreview {
  return {
    type: message.type,
    ...(isUserNotice(message) ? { noticeText: userNoticeText(message) } : {}),
    createdAt: message.createdAt,
    ...('author' in message ? { nickname: message.author.nickname } : {}),
    ...(message.type === 'new-follower'
      ? { nickname: message.follower.nickname }
      : {}),
    ...(message.type === 'review-like'
      ? { nickname: message.latestLiker.nickname }
      : {}),
    ...('title' in message ? { title: message.title } : {}),
    ...(message.type === 'annual-report' || message.type === 'follow-recap'
      ? { year: message.year }
      : {}),
    ...(message.type === 'tracking-update'
      ? { toEpisodes: message.toEpisodes }
      : {}),
  };
}

export interface UserMessageSummary {
  latestUnreadAt: number;
  latestUnread: MessageToastPreview | null;
  unreadCount: number;
  trackingUnreadCount: number;
  followReviewUnreadCount: number;
  reviewReplyUnreadCount: number;
  newFollowerUnreadCount: number;
  reviewLikeUnreadCount: number;
  revision: string;
  announcement: AnnouncementUserMessage | null;
  annualReport?: AnnualReportUserMessage | null;
  latestTracking: TrackingUpdateUserMessage | null;
}

export interface ReadUserMessageResult {
  message: UserMessage;
  updatedRecord?: {
    key: string;
    record: import('./types').PlayRecord;
  };
}

export interface ReadAllUserMessagesResult {
  updatedRecords: Record<string, import('./types').PlayRecord>;
}
