import { readStorage, writeStorage } from '@/lib/browser-storage';

function key(username: string): string {
  return `messages_notified_at:${username.trim().toLowerCase()}`;
}

export function readNotifiedMessageAt(username: string): number {
  const value = Number(readStorage(key(username)));
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function writeNotifiedMessageAt(username: string, at: number): boolean {
  if (!Number.isSafeInteger(at) || at < 0) return false;
  return writeStorage(
    key(username),
    String(Math.max(at, readNotifiedMessageAt(username))),
  );
}
