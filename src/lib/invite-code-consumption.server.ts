import 'server-only';

import {
  isInviteCodeExpired,
  normalizeInviteCode,
} from '@/features/admin/services/inviteCodes';
import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';

// 名额占用只走数据库原子自增，不写配置，避免并发注册互相撞版本冲突
export async function reserveInviteCode(rawCode: unknown): Promise<boolean> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return false;

  const config = await getConfigForRead();
  const matched = (config.UserConfig.InviteCodes || []).find(
    (item) => item.code === code,
  );
  if (!matched || isInviteCodeExpired(matched)) return false;

  return db.reserveInviteCodeUse(
    code,
    matched.maxUses || 0,
    matched.usedCount || 0,
  );
}

export async function releaseInviteCode(rawCode: unknown): Promise<void> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return;

  try {
    await db.releaseInviteCodeUse(code);
  } catch (error) {
    console.warn('回滚邀请码次数失败:', error);
  }
}
