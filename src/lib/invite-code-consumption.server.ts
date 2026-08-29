import 'server-only';

import {
  consumeInviteCode,
  findUsableInviteCode,
  normalizeInviteCode,
} from '@/features/admin/services/inviteCodes';
import {
  ConfigConflictError,
  getConfig,
  invalidateConfigCache,
  saveConfig,
} from '@/lib/config';

const MAX_ATTEMPTS = 5;

// 先占用名额再建账号，冲突时重读配置重试
export async function reserveInviteCode(rawCode: unknown): Promise<boolean> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const config = await getConfig();
    const inviteCodes = config.UserConfig.InviteCodes || [];
    if (!findUsableInviteCode(inviteCodes, code)) {
      return false;
    }

    config.UserConfig.InviteCodes = consumeInviteCode(inviteCodes, code);

    try {
      await saveConfig(config);
      return true;
    } catch (error) {
      if (!(error instanceof ConfigConflictError)) {
        throw error;
      }
      invalidateConfigCache();
    }
  }

  return false;
}

export async function releaseInviteCode(rawCode: unknown): Promise<void> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const config = await getConfig();
    const inviteCodes = config.UserConfig.InviteCodes || [];
    const matched = inviteCodes.find((item) => item.code === code);
    if (!matched || !matched.maxUses || !matched.usedCount) {
      return;
    }

    config.UserConfig.InviteCodes = inviteCodes.map((item) =>
      item.code === code
        ? { ...item, usedCount: (item.usedCount || 0) - 1 }
        : item,
    );

    try {
      await saveConfig(config);
      return;
    } catch (error) {
      if (!(error instanceof ConfigConflictError)) {
        console.warn('回滚邀请码次数失败:', error);
        return;
      }
      invalidateConfigCache();
    }
  }
}
