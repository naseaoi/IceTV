'use client';

import { applyPlayRecordStateUpdates } from '@/lib/db.client';
import { fetchWithAuth } from '@/lib/db.client.internal';
import { DEFAULT_MESSAGE_PAGE_LIMIT } from '@/lib/message-page';
import {
  AnnouncementHistoryPage,
  MessageNotificationKind,
  ReadAllUserMessagesResult,
  ReadUserMessageResult,
  UserMessagePage,
  UserMessageSummary,
} from '@/lib/message-types';

export async function getMessageSummary(): Promise<UserMessageSummary> {
  const response = await fetchWithAuth('/api/messages?view=summary', {
    cache: 'no-store',
  });
  return response.json() as Promise<UserMessageSummary>;
}

export async function getMessagePage(
  cursor?: string | null,
): Promise<UserMessagePage> {
  const params = new URLSearchParams({
    limit: String(DEFAULT_MESSAGE_PAGE_LIMIT),
  });
  if (cursor) params.set('cursor', cursor);
  const response = await fetchWithAuth(`/api/messages?${params.toString()}`, {
    cache: 'no-store',
  });
  return response.json() as Promise<UserMessagePage>;
}

export async function getAnnouncementHistoryPage(
  cursor?: string | null,
): Promise<AnnouncementHistoryPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const response = await fetchWithAuth(`/api/messages/announcements${query}`, {
    cache: 'no-store',
  });
  return response.json() as Promise<AnnouncementHistoryPage>;
}

export async function readMessage(
  messageId: string,
): Promise<ReadUserMessageResult> {
  const response = await fetchWithAuth('/api/messages', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'read', messageId }),
  });
  const result = (await response.json()) as ReadUserMessageResult;
  if (result.updatedRecord) {
    applyPlayRecordStateUpdates({
      [result.updatedRecord.key]: result.updatedRecord.record,
    });
  }
  return result;
}

export async function readAllMessages(): Promise<ReadAllUserMessagesResult> {
  const response = await fetchWithAuth('/api/messages', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'read-all' }),
  });
  const result = (await response.json()) as ReadAllUserMessagesResult;
  applyPlayRecordStateUpdates(result.updatedRecords);
  return result;
}

export async function fetchMessageSettings(): Promise<{
  mutedKinds: MessageNotificationKind[];
}> {
  const response = await fetchWithAuth('/api/messages/settings', {
    cache: 'no-store',
  });
  return response.json();
}
export async function saveMessageSettings(
  mutedKinds: MessageNotificationKind[],
): Promise<{ mutedKinds: MessageNotificationKind[] }> {
  const response = await fetchWithAuth('/api/messages/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mutedKinds }),
  });
  return response.json();
}
