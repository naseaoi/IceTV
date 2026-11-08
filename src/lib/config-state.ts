import type { AdminConfig } from '@/types/admin';

export const CONFIG_SUBSCRIPTION_MAX_BYTES = 2 * 1024 * 1024;

export type ConfigSubscription = {
  ConfigFile: string;
  ConfigSubscribtion: { URL: string; AutoUpdate: boolean; LastCheck: string };
};
export type ConfigStateUpdate = {
  subscription?: { expected: ConfigSubscription; next: ConfigSubscription };
  liveCounts?: Record<string, number>;
};
export type SubscriptionRow = {
  url: string;
  auto_update: number;
  last_check: string;
  config_file: string;
};
export const SUBSCRIPTION_INSERT =
  'INSERT INTO config_subscription (id, url, auto_update, last_check, config_file) VALUES (1, ?, ?, ?, ?)';

export function subscriptionFromConfig(
  config?: Partial<ConfigSubscription> | null,
): ConfigSubscription {
  return {
    ConfigFile: config?.ConfigFile || '',
    ConfigSubscribtion: {
      URL: config?.ConfigSubscribtion?.URL || '',
      AutoUpdate: config?.ConfigSubscribtion?.AutoUpdate === true,
      LastCheck: config?.ConfigSubscribtion?.LastCheck || '',
    },
  };
}
export function subscriptionFromRow(row?: SubscriptionRow): ConfigSubscription {
  return subscriptionFromConfig(
    row
      ? {
          ConfigFile: row.config_file,
          ConfigSubscribtion: {
            URL: row.url,
            AutoUpdate: !!row.auto_update,
            LastCheck: row.last_check,
          },
        }
      : undefined,
  );
}
export function subscriptionValues(
  value: ConfigSubscription,
): (string | number)[] {
  const sub = value.ConfigSubscribtion;
  return [sub.URL, Number(sub.AutoUpdate), sub.LastCheck, value.ConfigFile];
}
export function stripConfigState(config: AdminConfig): AdminConfig {
  delete (config as Partial<ConfigSubscription>).ConfigFile;
  delete (config as Partial<ConfigSubscription>).ConfigSubscribtion;
  for (const live of config.LiveConfig || []) delete live.channelNumber;
  return config;
}
export function hasLegacyConfigState(config: AdminConfig): boolean {
  return (
    Object.hasOwn(config, 'ConfigFile') ||
    Object.hasOwn(config, 'ConfigSubscribtion') ||
    (config.LiveConfig || []).some((live) =>
      Object.hasOwn(live, 'channelNumber'),
    )
  );
}
export function sameSubscription(
  a: ConfigSubscription,
  b: ConfigSubscription,
): boolean {
  return (
    JSON.stringify(subscriptionValues(a)) ===
    JSON.stringify(subscriptionValues(b))
  );
}
export function validChannelNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
