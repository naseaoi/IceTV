import 'server-only';

import { createHash } from 'crypto';

import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
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
  hasPlayRecordUpdate,
  markPlayRecordUpdateRead,
} from '@/lib/play-records';
import { PlayRecord, UserMessageState } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

const DEFAULT_MESSAGE_PAGE_LIMIT = 20;
const MAX_MESSAGE_PAGE_LIMIT = 50;
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
  const baselineValue = record.group_total
    ? record.update_baseline_group_total
    : record.update_baseline_episodes;
  const fromEpisodes = Number.isFinite(baselineValue)
    ? Number(baselineValue)
    : totalEpisodes;
  const encodedKey = encodeURIComponent(recordKey);

  return {
    id: `tracking:${encodedKey}:${fromEpisodes}:${totalEpisodes}`,
    type: 'tracking-update',
    recordKey,
    source: parsed.source,
    videoId: parsed.id,
    title: record.title,
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

function messageSortRank(message: UserMessage): number {
  return message.type === 'announcement' ? 0 : 1;
}

function sortMessages<T extends UserMessage>(messages: T[]): T[] {
  return messages.sort(
    (left, right) =>
      messageSortRank(left) - messageSortRank(right) ||
      right.createdAt - left.createdAt ||
      right.id.localeCompare(left.id),
  );
}

function encodeCursor(message: TrackingUpdateUserMessage): string {
  return encodeCursorPosition(message.createdAt, message.recordKey);
}

function encodeCursorPosition(createdAt: number, key: string): string {
  return Buffer.from(JSON.stringify({ createdAt, key })).toString('base64url');
}

function decodeCursor(
  cursor?: string | null,
): { createdAt: number; key: string } | null {
  if (!cursor || cursor.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as {
      createdAt?: unknown;
      key?: unknown;
    };
    return typeof parsed.createdAt === 'number' &&
      Number.isFinite(parsed.createdAt) &&
      typeof parsed.key === 'string'
      ? { createdAt: parsed.createdAt, key: parsed.key }
      : null;
  } catch {
    return null;
  }
}

export function normalizeMessageLimit(value: string | number | null): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MESSAGE_PAGE_LIMIT;
  }
  return Math.min(MAX_MESSAGE_PAGE_LIMIT, Math.floor(parsed));
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

export async function getUserMessagePage(
  userName: string,
  limit: number,
  cursor?: string | null,
): Promise<UserMessagePage> {
  const decodedCursor = decodeCursor(cursor);
  const [{ announcement }, trackingPage] = await Promise.all([
    getAnnouncementContext(userName),
    db.getUnreadTrackingPlayRecordPage(
      userName,
      limit,
      decodedCursor?.createdAt,
      decodedCursor?.key,
    ),
  ]);
  const includeAnnouncement = !decodedCursor && !!announcement;
  const trackingLimit = Math.max(0, limit - (includeAnnouncement ? 1 : 0));
  const tracking = buildTrackingMessages(trackingPage.items);
  const pageTracking = tracking.slice(0, trackingLimit);
  const items: UserMessage[] = [
    ...(includeAnnouncement && announcement ? [announcement] : []),
    ...pageTracking,
  ];
  const lastTracking = pageTracking.at(-1);
  const hasMoreTracking =
    tracking.length > pageTracking.length || !!trackingPage.nextCursor;

  return {
    items,
    total: trackingPage.total + (announcement ? 1 : 0),
    nextCursor: hasMoreTracking
      ? lastTracking
        ? encodeCursor(lastTracking)
        : encodeCursorPosition(Number.MAX_SAFE_INTEGER, '\uffff')
      : null,
  };
}

export async function getUserMessageSummary(
  userName: string,
): Promise<UserMessageSummary> {
  const [{ announcement }, trackingPage] = await Promise.all([
    getAnnouncementContext(userName),
    db.getUnreadTrackingPlayRecordPage(userName, 1),
  ]);
  const tracking = buildTrackingMessages(trackingPage.items);
  const messages = sortMessages<UserMessage>([
    ...(announcement ? [announcement] : []),
    ...tracking,
  ]);
  const unreadCount = trackingPage.total + (announcement ? 1 : 0);
  const revision = hashValue(
    [unreadCount, ...messages.map((message) => message.id)].join('|'),
  );
  return {
    unreadCount,
    trackingUnreadCount: trackingPage.total,
    revision,
    latestMessage: messages[0] || null,
  };
}

export async function readUserMessage(
  userName: string,
  messageId: string,
): Promise<ReadUserMessageResult | null> {
  const { announcement, state } = await getAnnouncementContext(userName);
  if (announcement?.id === messageId) {
    await db.setUserMessageState(userName, {
      ...state,
      readAnnouncementId: announcement.id,
    });
    return { message: announcement };
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
  if (announcement) {
    await db.setUserMessageState(userName, {
      ...state,
      readAnnouncementId: announcement.id,
    });
  }

  const updatedRecords: Record<string, PlayRecord> = {};
  for (;;) {
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
