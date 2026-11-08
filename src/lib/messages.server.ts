import 'server-only';

import { createHash } from 'crypto';

import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import {
  decodeCursor,
  encodeCursor,
  encodeCursorPosition,
  messageSortKey,
} from '@/lib/message-cursor.server';
import {
  AnnouncementUserMessage,
  ReadAllUserMessagesResult,
  ReadUserMessageResult,
  TrackingUpdateUserMessage,
  UserMessage,
  UserMessagePage,
  UserMessageSummary,
} from '@/lib/message-types';
import {
  getPlayRecordEpisodeDisplay,
  getPlayRecordUpdateBaseline,
  hasPlayRecordUpdate,
  markPlayRecordUpdateRead,
} from '@/lib/play-records';
import { PlayRecord, UserMessageState } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

const READ_ALL_BATCH_SIZE = 200;

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

function buildAnnouncementMessage(
  announcement: string,
  version?: string,
  publishedAt?: number,
): AnnouncementUserMessage | null {
  const content = announcement.trim();
  if (!content) return null;

  return {
    id: `announcement:${version || hashValue(content)}`,
    type: 'announcement',
    content,
    createdAt:
      typeof publishedAt === 'number' && Number.isFinite(publishedAt)
        ? publishedAt
        : 0,
  };
}

function buildTrackingMessage(
  recordKey: string,
  record: PlayRecord,
): TrackingUpdateUserMessage | null {
  if (!hasPlayRecordUpdate(record)) return null;
  const parsed = parseStorageKey(recordKey);
  if (!parsed) return null;

  const { totalEpisodes } = getPlayRecordEpisodeDisplay(record);
  const fromEpisodes = getPlayRecordUpdateBaseline(record);
  const encodedKey = encodeURIComponent(recordKey);

  return {
    id: `tracking:${encodedKey}:${fromEpisodes}:${totalEpisodes}`,
    type: 'tracking-update',
    recordKey,
    source: parsed.source,
    videoId: parsed.id,
    title: record.title,
    year: record.year,
    ...(record.search_title ? { searchTitle: record.search_title } : {}),
    sourceName: record.source_name,
    cover: record.cover,
    fromEpisodes,
    toEpisodes: totalEpisodes,
    createdAt:
      record.update_detected_at ||
      record.metadata_checked_at ||
      record.save_time,
  };
}

async function getAnnouncementContext(userName: string): Promise<{
  announcement: AnnouncementUserMessage | null;
  state: UserMessageState;
}> {
  const [config, state] = await Promise.all([
    getConfigForRead(),
    db.getUserMessageState(userName),
  ]);
  const siteConfig = config.SiteConfig;
  const currentAnnouncement = buildAnnouncementMessage(
    siteConfig.Announcement,
    siteConfig.AnnouncementVersion,
    siteConfig.AnnouncementPublishedAt,
  );
  const announcement =
    currentAnnouncement?.id === state.readAnnouncementId
      ? null
      : currentAnnouncement;
  return { announcement, state };
}

function buildTrackingMessages(
  records: Record<string, PlayRecord>,
): TrackingUpdateUserMessage[] {
  return Object.entries(records).flatMap(([key, record]) => {
    const message = buildTrackingMessage(key, record);
    return message ? [message] : [];
  });
}

function parseTrackingMessageId(messageId: string): {
  recordKey: string;
  fromEpisodes: number;
  toEpisodes: number;
} | null {
  const match = /^tracking:(.+):(\d+):(\d+)$/.exec(messageId);
  if (!match) return null;
  try {
    const recordKey = decodeURIComponent(match[1]);
    const fromEpisodes = Number(match[2]);
    const toEpisodes = Number(match[3]);
    return recordKey &&
      Number.isFinite(fromEpisodes) &&
      Number.isFinite(toEpisodes)
      ? { recordKey, fromEpisodes, toEpisodes }
      : null;
  } catch {
    return null;
  }
}

async function getVisibleMessageSources(
  userName: string,
  state: UserMessageState,
  limit: number,
  before?: import('@/lib/message-cursor.server').MessageCursor | null,
) {
  const muted = new Set(state.mutedKinds ?? []);
  const now = Date.now();
  const query = { limit, before };
  const followArgs = [
    userName,
    state.followReviewReadAt ?? 0,
    state.followReviewReadIds ?? [],
    now,
  ] as const;
  const replyArgs = [
    userName,
    state.reviewReplyReadAt ?? 0,
    state.reviewReplyReadIds ?? [],
    now,
  ] as const;
  const newArgs = [
    'new-follower',
    userName,
    state.newFollowerReadAt ?? 0,
    state.newFollowerReadIds ?? [],
    now,
  ] as const;
  const likeArgs = [
    'review-like',
    userName,
    state.reviewLikeReadAt ?? 0,
    state.reviewLikeReadIds ?? [],
    now,
  ] as const;
  const [
    tracking,
    followed,
    followCount,
    replies,
    replyCount,
    followers,
    followerCount,
    likes,
    likeCount,
  ] = await Promise.all([
    muted.has('tracking-update')
      ? { items: {}, total: 0, nextCursor: null }
      : db.getUnreadTrackingPlayRecordPage(
          userName,
          limit,
          before?.createdAt,
          before
            ? before.key.startsWith('tracking:')
              ? before.key.slice(9)
              : '\u0001'
            : undefined,
        ),
    muted.has('follow-review')
      ? []
      : db.getFollowReviewMessages(...followArgs, query),
    muted.has('follow-review')
      ? 0
      : db.getFollowReviewMessageCount(...followArgs),
    muted.has('review-reply')
      ? []
      : db.getReviewReplyMessages(...replyArgs, query),
    muted.has('review-reply') ? 0 : db.getReviewReplyMessageCount(...replyArgs),
    muted.has('new-follower')
      ? []
      : db.getSocialNotifications(...newArgs, query),
    muted.has('new-follower') ? 0 : db.getSocialNotificationCount(...newArgs),
    muted.has('review-like')
      ? []
      : db.getSocialNotifications(...likeArgs, query),
    muted.has('review-like') ? 0 : db.getSocialNotificationCount(...likeArgs),
  ]);
  return {
    tracking,
    followed,
    followCount,
    replies,
    replyCount,
    followers,
    followerCount,
    likes,
    likeCount,
  };
}

export async function getUserMessagePage(
  userName: string,
  limit: number,
  cursor?: string | null,
): Promise<UserMessagePage> {
  const before = decodeCursor(cursor);
  const { announcement, state } = await getAnnouncementContext(userName);
  const sources = await getVisibleMessageSources(
    userName,
    state,
    limit + 1,
    before,
  );
  const includeAnnouncement = !before && !!announcement;
  const pageLimit = Math.max(0, limit - (includeAnnouncement ? 1 : 0));
  const merged: UserMessage[] = [
    ...buildTrackingMessages(sources.tracking.items),
    ...sources.followed,
    ...sources.replies,
    ...sources.followers,
    ...sources.likes,
  ];
  const remaining = merged.filter(
    (message) =>
      !before ||
      message.createdAt < before.createdAt ||
      (message.createdAt === before.createdAt &&
        messageSortKey(message) < before.key),
  );
  remaining.sort(
    (a, b) =>
      b.createdAt - a.createdAt ||
      (messageSortKey(a) < messageSortKey(b) ? 1 : -1),
  );
  const page = remaining.slice(0, pageLimit);
  const hasMore =
    remaining.length > page.length || !!sources.tracking.nextCursor;
  return {
    items: [
      ...(includeAnnouncement && announcement ? [announcement] : []),
      ...page,
    ],
    total:
      sources.tracking.total +
      sources.followCount +
      sources.replyCount +
      sources.followerCount +
      sources.likeCount +
      (announcement ? 1 : 0),
    nextCursor: hasMore
      ? page.length
        ? encodeCursor(page[page.length - 1])
        : encodeCursorPosition(Number.MAX_SAFE_INTEGER, '￿')
      : null,
  };
}

export async function getUserMessageSummary(
  userName: string,
): Promise<UserMessageSummary> {
  const { announcement, state } = await getAnnouncementContext(userName);
  const sources = await getVisibleMessageSources(userName, state, 1);
  const latestTracking =
    buildTrackingMessages(sources.tracking.items)[0] ?? null;
  const unreadCount =
    sources.tracking.total +
    sources.followCount +
    sources.replyCount +
    sources.followerCount +
    sources.likeCount +
    (announcement ? 1 : 0);
  const latest = [
    ...sources.followed,
    ...sources.replies,
    ...sources.followers,
    ...sources.likes,
  ];
  return {
    unreadCount,
    trackingUnreadCount: sources.tracking.total,
    followReviewUnreadCount: sources.followCount,
    reviewReplyUnreadCount: sources.replyCount,
    newFollowerUnreadCount: sources.followerCount,
    reviewLikeUnreadCount: sources.likeCount,
    revision: hashValue(
      [
        unreadCount,
        sources.tracking.total,
        sources.followCount,
        sources.replyCount,
        sources.followerCount,
        sources.likeCount,
        announcement?.id ?? '',
        latestTracking?.id ?? '',
        ...latest.map(
          (message) =>
            `${message.id}${message.type === 'review-like' ? `:${message.likeCount}` : ''}`,
        ),
      ].join('|'),
    ),
    announcement,
    latestTracking,
  };
}

export async function readUserMessage(
  userName: string,
  messageId: string,
): Promise<ReadUserMessageResult | null> {
  const { announcement, state } = await getAnnouncementContext(userName);
  if (announcement?.id === messageId) {
    await db.updateUserMessageState(userName, {
      announcement: {
        id: announcement.id,
        previousId: state.readAnnouncementId,
      },
    });
    return { message: announcement };
  }

  const messageKind = messageId.startsWith('tracking:')
    ? 'tracking-update'
    : messageId.split(':')[0];
  if (state.mutedKinds?.some((kind) => kind === messageKind)) return null;
  for (const [kind, field] of [
    ['new-follower', 'newFollower'],
    ['review-like', 'reviewLike'],
  ] as const) {
    if (!messageId.startsWith(`${kind}:`)) continue;
    const messages = await db.getSocialNotifications(
      kind,
      userName,
      state[`${field}ReadAt`] ?? 0,
      state[`${field}ReadIds`] ?? [],
      Date.now(),
      { id: messageId, limit: 1 },
    );
    const message = messages.find((item) => item.id === messageId);
    if (!message) return null;
    await db.updateUserMessageState(userName, {
      [field]: { id: messageId, createdAt: message.createdAt },
    });
    return { message };
  }

  if (messageId.startsWith('review-reply:')) {
    const messages = await db.getReviewReplyMessages(
      userName,
      state.reviewReplyReadAt ?? 0,
      state.reviewReplyReadIds ?? [],
      Date.now(),
      { id: messageId, limit: 1 },
    );
    const message = messages.find((item) => item.id === messageId);
    if (!message) return null;
    await db.updateUserMessageState(userName, {
      reviewReply: { id: messageId, createdAt: message.createdAt },
    });
    return { message };
  }

  if (messageId.startsWith('follow-review:')) {
    const messages = await db.getFollowReviewMessages(
      userName,
      state.followReviewReadAt ?? 0,
      state.followReviewReadIds ?? [],
      Date.now(),
      { id: messageId, limit: 1 },
    );
    const message = messages.find((item) => item.id === messageId);
    if (!message) return null;
    await db.updateUserMessageState(userName, {
      followReview: { id: messageId, createdAt: message.createdAt },
    });
    return { message };
  }

  const parsedMessage = parseTrackingMessageId(messageId);
  if (!parsedMessage) return null;
  const parsedRecordKey = parseStorageKey(parsedMessage.recordKey);
  if (!parsedRecordKey) return null;
  const currentRecord = await db.getPlayRecord(
    userName,
    parsedRecordKey.source,
    parsedRecordKey.id,
  );
  if (!currentRecord) return null;
  const currentMessage = buildTrackingMessage(
    parsedMessage.recordKey,
    currentRecord,
  );
  if (!currentMessage || currentMessage.toEpisodes < parsedMessage.toEpisodes) {
    return null;
  }
  const message: TrackingUpdateUserMessage = {
    ...currentMessage,
    id: messageId,
    fromEpisodes: parsedMessage.fromEpisodes,
    toEpisodes: parsedMessage.toEpisodes,
  };
  const updatedRecord = markPlayRecordUpdateRead(
    currentRecord,
    message.toEpisodes,
  );
  await db.savePlayRecord(
    userName,
    message.source,
    message.videoId,
    updatedRecord,
  );
  return {
    message,
    updatedRecord: { key: message.recordKey, record: updatedRecord },
  };
}

export async function readAllUserMessages(
  userName: string,
): Promise<ReadAllUserMessagesResult> {
  const { announcement, state } = await getAnnouncementContext(userName);
  await db.updateUserMessageState(userName, {
    ...(announcement
      ? {
          announcement: {
            id: announcement.id,
            previousId: state.readAnnouncementId,
          },
        }
      : {}),
    followReviewReadAt: Date.now(),
    reviewReplyReadAt: Date.now(),
    newFollowerReadAt: Date.now(),
    reviewLikeReadAt: Date.now(),
  });

  const updatedRecords: Record<string, PlayRecord> = {};
  while (!state.mutedKinds?.includes('tracking-update')) {
    const page = await db.getUnreadTrackingPlayRecordPage(
      userName,
      READ_ALL_BATCH_SIZE,
    );
    const batch: Record<string, PlayRecord> = {};
    for (const [recordKey, record] of Object.entries(page.items)) {
      const message = buildTrackingMessage(recordKey, record);
      if (!message) continue;
      batch[recordKey] = markPlayRecordUpdateRead(record, message.toEpisodes);
    }
    if (Object.keys(batch).length === 0) break;
    await db.savePlayRecordsByKey(userName, batch);
    Object.assign(updatedRecords, batch);
  }

  return { updatedRecords };
}
