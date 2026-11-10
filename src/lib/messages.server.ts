import 'server-only';

import { createHash } from 'crypto';

import {
  buildAnnouncementMessageId,
  parseAnnouncementMessageId,
} from '@/lib/announcement-identity';
import { getAnnualReportMessage } from '@/lib/annual-report-message.server';
import { db } from '@/lib/db';
import {
  decodeCursor,
  encodeCursor,
  encodeCursorPosition,
  messageSortKey,
} from '@/lib/message-cursor.server';
import {
  AnnouncementHistoryPage,
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
import { PlayRecord, SiteAnnouncement, UserMessageState } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';
import { ReviewValidationError } from '@/lib/video-reviews';

const READ_ALL_BATCH_SIZE = 200;
// 与社交通知一致只回看最近 30 天：新注册用户不会收到全部历史公告
const ANNOUNCEMENT_UNREAD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const ANNOUNCEMENT_UNREAD_LIMIT = 50;
const ANNOUNCEMENT_HISTORY_LIMIT = 20;

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

function toAnnouncementMessage(
  row: SiteAnnouncement,
): AnnouncementUserMessage | null {
  if (row.publishedAt === null) return null;
  return {
    id: buildAnnouncementMessageId(row.id, row.publishedAt),
    type: 'announcement',
    content: row.content,
    createdAt: row.publishedAt,
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
  announcements: AnnouncementUserMessage[];
  state: UserMessageState;
}> {
  const [rows, state] = await Promise.all([
    db.getPublishedAnnouncements({
      since: Date.now() - ANNOUNCEMENT_UNREAD_WINDOW_MS,
      limit: ANNOUNCEMENT_UNREAD_LIMIT,
    }),
    db.getUserMessageState(userName),
  ]);
  const readAt = state.announcementReadAt ?? 0;
  const readIds = new Set(state.announcementReadIds ?? []);
  const announcements = rows.flatMap((row) => {
    const message = toAnnouncementMessage(row);
    return message && message.createdAt > readAt && !readIds.has(message.id)
      ? [message]
      : [];
  });
  return { announcements, state };
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
    recaps,
    recapCount,
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
    muted.has('follow-review')
      ? []
      : db.getFollowRecapMessages(...followArgs, query),
    muted.has('follow-review')
      ? 0
      : db.getFollowRecapMessageCount(...followArgs),
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
    followed: [...followed, ...recaps],
    followCount: followCount + recapCount,
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
  timeZone = 'UTC',
): Promise<UserMessagePage> {
  const before = decodeCursor(cursor);
  const { announcements, state } = await getAnnouncementContext(userName);
  const sources = await getVisibleMessageSources(
    userName,
    state,
    limit + 1,
    before,
  );
  const annualReport = await getAnnualReportMessage(userName, state, timeZone);
  const pinned = before
    ? []
    : [...announcements, ...(annualReport ? [annualReport] : [])].sort(
        (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
      );
  const pageLimit = Math.max(0, limit - pinned.length);
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
    items: [...pinned, ...page],
    total:
      sources.tracking.total +
      sources.followCount +
      sources.replyCount +
      sources.followerCount +
      sources.likeCount +
      announcements.length +
      (annualReport ? 1 : 0),
    nextCursor: hasMore
      ? page.length
        ? encodeCursor(page[page.length - 1])
        : encodeCursorPosition(Number.MAX_SAFE_INTEGER, '￿')
      : null,
  };
}

export async function getUserMessageSummary(
  userName: string,
  timeZone = 'UTC',
): Promise<UserMessageSummary> {
  const { announcements, state } = await getAnnouncementContext(userName);
  const [sources, annualReport] = await Promise.all([
    getVisibleMessageSources(userName, state, 1),
    getAnnualReportMessage(userName, state, timeZone),
  ]);
  const latestTracking =
    buildTrackingMessages(sources.tracking.items)[0] ?? null;
  const unreadCount =
    sources.tracking.total +
    sources.followCount +
    sources.replyCount +
    sources.followerCount +
    sources.likeCount +
    announcements.length +
    (annualReport ? 1 : 0);
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
        ...announcements.map((message) => message.id),
        annualReport?.id ?? '',
        latestTracking?.id ?? '',
        ...latest.map(
          (message) =>
            `${message.id}${message.type === 'review-like' ? `:${message.likeCount}` : ''}`,
        ),
      ].join('|'),
    ),
    announcement: announcements[0] ?? null,
    annualReport,
    latestTracking,
  };
}

export async function readUserMessage(
  userName: string,
  messageId: string,
  timeZone = 'UTC',
): Promise<ReadUserMessageResult | null> {
  if (messageId.startsWith('annual-report:')) {
    // 重复已读仍可成功；资格重新按当前用户与开放期检查。
    const message = await getAnnualReportMessage(userName, {}, timeZone);
    if (!message || message.id !== messageId) return null;
    await db.updateUserMessageState(userName, {
      annualReportReadYear: message.year,
    });
    return { message };
  }
  if (messageId.startsWith('announcement:')) {
    const parsed = parseAnnouncementMessageId(messageId);
    const row = parsed ? await db.getAnnouncement(parsed.rowId) : null;
    const message = row ? toAnnouncementMessage(row) : null;
    if (!message || message.id !== messageId) return null;
    await db.updateUserMessageState(userName, {
      announcement: { id: message.id, createdAt: message.createdAt },
    });
    return { message };
  }

  const state = await db.getUserMessageState(userName);

  const messageKind = messageId.startsWith('tracking:')
    ? 'tracking-update'
    : messageId.startsWith('follow-recap:')
      ? 'follow-review'
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

  if (
    messageId.startsWith('follow-review:') ||
    messageId.startsWith('follow-recap:')
  ) {
    const getMessages = messageId.startsWith('follow-recap:')
      ? db.getFollowRecapMessages.bind(db)
      : db.getFollowReviewMessages.bind(db);
    const messages = await getMessages(
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
  timeZone = 'UTC',
): Promise<ReadAllUserMessagesResult> {
  const state = await db.getUserMessageState(userName);
  const annualReport = await getAnnualReportMessage(userName, state, timeZone);
  await db.updateUserMessageState(userName, {
    ...(annualReport ? { annualReportReadYear: annualReport.year } : {}),
    announcementReadAt: Date.now(),
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

export async function getAnnouncementHistory(
  cursor?: string | null,
): Promise<AnnouncementHistoryPage> {
  const before = decodeAnnouncementCursor(cursor);
  const rows = await db.getPublishedAnnouncements({
    ...(before ? { before } : {}),
    limit: ANNOUNCEMENT_HISTORY_LIMIT + 1,
  });
  const page = rows.slice(0, ANNOUNCEMENT_HISTORY_LIMIT);
  const last = page[page.length - 1];
  return {
    items: page.flatMap((row) => {
      const message = toAnnouncementMessage(row);
      return message ? [message] : [];
    }),
    nextCursor:
      rows.length > page.length && last?.publishedAt != null
        ? `${last.publishedAt}:${last.id}`
        : null,
  };
}

function decodeAnnouncementCursor(
  cursor?: string | null,
): { publishedAt: number; id: string } | null {
  if (!cursor) return null;
  const match = /^(\d+):(.+)$/.exec(cursor);
  const publishedAt = Number(match?.[1]);
  if (!match || !Number.isSafeInteger(publishedAt) || match[2].length > 64)
    throw new ReviewValidationError('公告列表已更新，请重新打开');
  return { publishedAt, id: match[2] };
}
