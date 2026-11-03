import 'server-only';

import type { UserMessage } from '@/lib/message-types';

const MAX_CURSOR_LENGTH = 4000;

export interface MessageCursor {
  createdAt: number;
  key: string;
}

export function messageSortKey(message: UserMessage): string {
  return message.type === 'tracking-update'
    ? `tracking:${message.recordKey}`
    : message.id;
}

export function encodeCursor(message: UserMessage): string {
  return encodeCursorPosition(message.createdAt, messageSortKey(message));
}

export function encodeCursorPosition(createdAt: number, key: string): string {
  return Buffer.from(JSON.stringify({ createdAt, key })).toString('base64url');
}

export function decodeCursor(cursor?: string | null): MessageCursor | null {
  if (!cursor || cursor.length > MAX_CURSOR_LENGTH) return null;
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
