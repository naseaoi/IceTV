'use client';

import { applyPlayRecordStateUpdates } from '@/lib/db.client';
import { fetchWithAuth } from '@/lib/db.client.internal';
import {
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
  const params = new URLSearchParams({ limit: '20' });
  if (cursor) params.set('cursor', cursor);
  const response = await fetchWithAuth(`/api/messages?${params.toString()}`, {
    cache: 'no-store',
  });
  return response.json() as Promise<UserMessagePage>;
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
