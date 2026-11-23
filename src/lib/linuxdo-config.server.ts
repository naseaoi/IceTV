import 'server-only';

import type { AdminConfig } from '@/types/admin';

export function isLinuxDoConfigured(
  config: Pick<AdminConfig, 'UserConfig'>,
): boolean {
  return !!(
    config.UserConfig.LinuxDo?.ClientId?.trim() &&
    config.UserConfig.LinuxDo?.ClientSecret?.trim()
  );
}
export function isLinuxDoLoginEnabled(
  config: Pick<AdminConfig, 'UserConfig'>,
): boolean {
  return (
    isLinuxDoConfigured(config) && config.UserConfig.LinuxDo?.Enabled === true
  );
}
