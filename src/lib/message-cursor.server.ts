import 'server-only';

import { followReviewSortKey } from '@/lib/follow-review-identity';
import type { UserMessage } from '@/lib/message-types';
import { ReviewValidationError } from '@/lib/video-reviews';

const MAX_CURSOR_LENGTH = 4000;

export interface MessageCursor {
  createdAt: number;
  key: string;
}

export function messageSortKey(message: UserMessage): string {
  return message.type === 'tracking-update'
    ? `tracking:${message.recordKey}`
    : message.type === 'follow-review'
      ? followReviewSortKey(message.id)
      : message.id;
}

export function encodeCursor(message: UserMessage): string {
  return encodeCursorPosition(message.createdAt, messageSortKey(message));
}

export function encodeCursorPosition(createdAt: number, key: string): string {
  return Buffer.from(JSON.stringify({ version: 2, createdAt, key })).toString(
    'base64url',
  );
}

export function decodeCursor(cursor?: string | null): MessageCursor | null {
  if (!cursor || cursor.length > MAX_CURSOR_LENGTH) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as {
      version?: unknown;
      createdAt?: unknown;
      key?: unknown;
    };
    if (
      parsed.version !== 2 &&
      typeof parsed.key === 'string' &&
      parsed.key.startsWith('follow-review:')
    ) {
      throw new ReviewValidationError('消息分页已更新，请重新打开消息列表');
    }
    return typeof parsed.createdAt === 'number' &&
      Number.isFinite(parsed.createdAt) &&
      typeof parsed.key === 'string'
      ? { createdAt: parsed.createdAt, key: parsed.key }
      : null;
  } catch (error) {
    if (error instanceof ReviewValidationError) throw error;
    return null;
  }
}
