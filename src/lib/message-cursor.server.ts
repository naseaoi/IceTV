import 'server-only';

import type { TrackingUpdateUserMessage } from '@/lib/message-types';

const MAX_CURSOR_LENGTH = 512;

export interface MessageCursor {
  createdAt: number;
  key: string;
}

export function encodeCursor(message: TrackingUpdateUserMessage): string {
  return encodeCursorPosition(message.createdAt, message.recordKey);
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
