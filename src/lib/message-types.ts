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
  | AnnualReportUserMessage
  | AnnouncementUserMessage
  | TrackingUpdateUserMessage
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

export interface UserMessageSummary {
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
