import { db } from '@/lib/db';

// 用尽但未到期的码没有记录用尽时间，随到期时间一并按保留期清理
export const INVITE_CODE_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function cleanupInviteCodes(now = Date.now()): Promise<void> {
  try {
    const deleted = await db.purgeInviteCodes({
      expiredBefore: now - INVITE_CODE_RETENTION_DAYS * DAY_MS,
      includeExhausted: false,
    });
    if (deleted > 0) {
      console.log(
        `邀请码清理完成：删除 ${deleted} 个过期超过 ${INVITE_CODE_RETENTION_DAYS} 天的邀请码`,
      );
    }
  } catch (error) {
    console.error('邀请码清理失败:', error);
  }
}
