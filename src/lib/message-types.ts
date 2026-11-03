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
  sourceName: string;
  cover: string;
  fromEpisodes: number;
  toEpisodes: number;
  createdAt: number;
}

export interface FollowReviewUserMessage {
  id: string;
  type: 'follow-review';
  author: import('./types').PublicUserRef;
  title: string;
  year: string;
  cover: string;
  rating: number | null;
  createdAt: number;
}

export type UserMessage =
  | AnnouncementUserMessage
  | TrackingUpdateUserMessage
  | FollowReviewUserMessage;

export interface UserMessagePage {
  items: UserMessage[];
  total: number;
  nextCursor: string | null;
}

export interface UserMessageSummary {
  unreadCount: number;
  trackingUnreadCount: number;
  followReviewUnreadCount: number;
  revision: string;
  announcement: AnnouncementUserMessage | null;
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
