import 'server-only';

import type { AdminConfig } from '@/types/admin';

export function isLinuxDoConfigured(): boolean {
  return !!(
    process.env.LINUXDO_CLIENT_ID?.trim() &&
    process.env.LINUXDO_CLIENT_SECRET?.trim()
  );
}
export function isLinuxDoLoginEnabled(
  config: Pick<AdminConfig, 'UserConfig'>,
): boolean {
  return isLinuxDoConfigured() && config.UserConfig.LinuxDo?.Enabled === true;
}
