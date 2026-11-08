export function followReviewMessageId(
  profileId: string,
  title: string,
  year: string,
  updatedAt: number,
): string {
  return `follow-review:${Buffer.from(JSON.stringify([profileId, title, year, updatedAt])).toString('base64url')}`;
}

export function parseFollowReviewMessageId(
  id: string,
): [string, string, string, number] | null {
  if (!id.startsWith('follow-review:') || id.length > 4000) return null;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(id.slice('follow-review:'.length), 'base64url').toString(
        'utf8',
      ),
    );
    return Array.isArray(value) &&
      value.length === 4 &&
      typeof value[0] === 'string' &&
      /^[A-Za-z0-9]{12}$/.test(value[0]) &&
      typeof value[1] === 'string' &&
      value[1].length > 0 &&
      value[1].length <= 191 &&
      typeof value[2] === 'string' &&
      value[2].length <= 16 &&
      Number.isSafeInteger(value[3]) &&
      value[3] >= 0
      ? (value as [string, string, string, number])
      : null;
  } catch {
    return null;
  }
}

export function followReviewSortKey(id: string): string {
  const identity = parseFollowReviewMessageId(id);
  if (!identity) return id;
  // 十六进制保持 UTF-8 二进制顺序，分隔符低于所有数字，使前缀字符串先于其扩展。
  return `follow-review:${identity
    .slice(0, 3)
    .map((part) => Buffer.from(String(part)).toString('hex'))
    .join('!')}`;
}

export function parseFollowReviewSortKey(key: string): string[] | null {
  if (!key.startsWith('follow-review:')) return null;
  const parts = key.slice(14).split('!');
  if (
    parts.length !== 3 ||
    parts.some((part) => !/^(?:[0-9a-f]{2})*$/.test(part))
  )
    return null;
  return parts.map((part) => Buffer.from(part, 'hex').toString('utf8'));
}

export interface FollowReviewQuery {
  limit?: number;
  before?: { createdAt: number; key: string } | null;
  id?: string;
}
