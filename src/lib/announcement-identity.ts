export const ANNOUNCEMENT_MAX_LENGTH = 2000;

// 消息 ID 带推送时间：撤回后重新推送会生成新 ID，重新形成未读；推送后静默修改正文 ID 不变
export function buildAnnouncementMessageId(
  rowId: string,
  publishedAt: number,
): string {
  return `announcement:${publishedAt}:${rowId}`;
}

export function parseAnnouncementMessageId(
  messageId: string,
): { rowId: string; publishedAt: number } | null {
  const match = /^announcement:(\d+):(.+)$/.exec(messageId);
  if (!match) return null;
  const publishedAt = Number(match[1]);
  return Number.isSafeInteger(publishedAt)
    ? { rowId: match[2], publishedAt }
    : null;
}
