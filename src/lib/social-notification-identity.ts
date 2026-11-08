import {
  type MessageNotificationKind,
  MESSAGE_NOTIFICATION_KINDS,
} from '@/lib/message-types';
import { ReviewValidationError } from '@/lib/video-reviews';

export type SocialNotificationKind = 'new-follower' | 'review-like';
export type SocialNotificationIdentity = [string, string, string, number];

export function socialNotificationId(
  kind: SocialNotificationKind,
  identity: SocialNotificationIdentity,
): string {
  return `${kind}:${Buffer.from(JSON.stringify(identity)).toString('base64url')}`;
}
export function parseSocialNotificationId(
  kind: SocialNotificationKind,
  id: string,
): SocialNotificationIdentity | null {
  if (!id.startsWith(`${kind}:`) || id.length > 4000) return null;
  try {
    const value = JSON.parse(
      Buffer.from(id.slice(kind.length + 1), 'base64url').toString('utf8'),
    );
    if (
      !Array.isArray(value) ||
      value.length !== 4 ||
      typeof value[0] !== 'string' ||
      !/^[A-Za-z0-9]{12}$/.test(value[0]) ||
      typeof value[1] !== 'string' ||
      value[1].length > 191 ||
      typeof value[2] !== 'string' ||
      value[2].length > 16 ||
      !Number.isSafeInteger(value[3]) ||
      value[3] < 0 ||
      (kind === 'review-like' && !value[1]) ||
      (kind === 'new-follower' && (value[1] || value[2]))
    )
      return null;
    return value as SocialNotificationIdentity;
  } catch {
    return null;
  }
}
export function socialNotificationSortKey(
  kind: SocialNotificationKind,
  id: string,
): string {
  const identity = parseSocialNotificationId(kind, id);
  return identity
    ? `${kind}:${identity
        .slice(0, 3)
        .map((part) => Buffer.from(String(part)).toString('hex'))
        .join('!')}`
    : id;
}
export function parseSocialNotificationSortKey(
  kind: SocialNotificationKind,
  key: string,
): string[] | null {
  if (!key.startsWith(`${kind}:`)) return null;
  const parts = key.slice(kind.length + 1).split('!');
  if (
    parts.length !== 3 ||
    parts.some((part) => !/^(?:[0-9a-f]{2})*$/.test(part))
  )
    return null;
  return parts.map((part) => Buffer.from(part, 'hex').toString('utf8'));
}
export function validateMutedKinds(value: unknown): MessageNotificationKind[] {
  if (
    !Array.isArray(value) ||
    value.some((kind) => !MESSAGE_NOTIFICATION_KINDS.includes(kind))
  )
    throw new ReviewValidationError('通知类型无效');
  return MESSAGE_NOTIFICATION_KINDS.filter((kind) => value.includes(kind));
}
