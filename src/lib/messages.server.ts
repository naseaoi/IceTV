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

function sortMessages<T extends UserMessage>(messages: T[]): T[] {
  return messages.sort(
    (left, right) =>
      right.createdAt - left.createdAt || right.id.localeCompare(left.id),
  );
}

function encodeCursor(message: TrackingUpdateUserMessage): string {
  return Buffer.from(
    JSON.stringify({ createdAt: message.createdAt, id: message.id }),
  ).toString('base64url');
}

function decodeCursor(
  cursor?: string | null,
): { createdAt: number; id: string } | null {
  if (!cursor || cursor.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as {
      createdAt?: unknown;
      id?: unknown;
    };
    return typeof parsed.createdAt === 'number' &&
      Number.isFinite(parsed.createdAt) &&
      typeof parsed.id === 'string'
      ? { createdAt: parsed.createdAt, id: parsed.id }
      : null;
  } catch {
    return null;
  }
}

function isAfterCursor(
  message: TrackingUpdateUserMessage,
  cursor: { createdAt: number; id: string },
): boolean {
  return (
    message.createdAt < cursor.createdAt ||
    (message.createdAt === cursor.createdAt && message.id < cursor.id)
  );
}

export function normalizeMessageLimit(value: string | number | null): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MESSAGE_PAGE_LIMIT;
  }
  return Math.min(MAX_MESSAGE_PAGE_LIMIT, Math.floor(parsed));
}

async function getUnreadMessages(userName: string): Promise<{
  announcement: AnnouncementUserMessage | null;
  tracking: TrackingUpdateUserMessage[];
  state: UserMessageState;
}> {
  const [config, records, state] = await Promise.all([
    getConfigForRead(),
    db.getAllPlayRecords(userName),
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
  const tracking = sortMessages(
    Object.entries(records).flatMap(([key, record]) => {
      const message = buildTrackingMessage(key, record);
      return message ? [message] : [];
    }),
  );
  return { announcement, tracking, state };
}

export async function getUserMessagePage(
  userName: string,
  limit: number,
  cursor?: string | null,
): Promise<UserMessagePage> {
  const { announcement, tracking } = await getUnreadMessages(userName);
  const decodedCursor = decodeCursor(cursor);
  const available = decodedCursor
    ? tracking.filter((message) => isAfterCursor(message, decodedCursor))
    : tracking;
  const includeAnnouncement = !decodedCursor && !!announcement;
  const trackingLimit = Math.max(0, limit - (includeAnnouncement ? 1 : 0));
  const pageTracking = available.slice(0, trackingLimit);
  const items: UserMessage[] = [
    ...(includeAnnouncement && announcement ? [announcement] : []),
    ...pageTracking,
  ];
  const lastTracking = pageTracking.at(-1);

  return {
    items,
    total: tracking.length + (announcement ? 1 : 0),
    nextCursor:
      lastTracking && available.length > pageTracking.length
        ? encodeCursor(lastTracking)
        : null,
  };
}

export async function getUserMessageSummary(
  userName: string,
): Promise<UserMessageSummary> {
  const { announcement, tracking } = await getUnreadMessages(userName);
  const messages = sortMessages<UserMessage>([
    ...(announcement ? [announcement] : []),
    ...tracking,
  ]);
  const revision = hashValue(messages.map((message) => message.id).join('|'));
  return {
    unreadCount: messages.length,
    revision,
    latestMessage: messages[0] || null,
  };
}

export async function readUserMessage(
  userName: string,
  messageId: string,
): Promise<ReadUserMessageResult | null> {
  const { announcement, tracking, state } = await getUnreadMessages(userName);
  if (announcement?.id === messageId) {
    await db.setUserMessageState(userName, {
      ...state,
      readAnnouncementId: announcement.id,
    });
    return { message: announcement };
  }

  const message = tracking.find((item) => item.id === messageId);
  if (!message) return null;
  const currentRecord = await db.getPlayRecord(
    userName,
    message.source,
    message.videoId,
  );
  if (!currentRecord) return null;
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
  const { announcement, tracking, state } = await getUnreadMessages(userName);
  if (announcement) {
    await db.setUserMessageState(userName, {
      ...state,
      readAnnouncementId: announcement.id,
    });
  }

  const updatedRecords: Record<string, PlayRecord> = {};
  for (const message of tracking) {
    const record = await db.getPlayRecord(
      userName,
      message.source,
      message.videoId,
    );
    if (!record) continue;
    const updatedRecord = markPlayRecordUpdateRead(record, message.toEpisodes);
    await db.savePlayRecord(
      userName,
      message.source,
      message.videoId,
      updatedRecord,
    );
    updatedRecords[message.recordKey] = updatedRecord;
  }

  return { updatedRecords };
}
