import {
  ConfigConflictError,
  configSelfCheck,
  getConfig,
  invalidateConfigCache,
  refineConfig,
  saveConfig,
} from '@/lib/config';
import {
  decodeConfigSubscriptionContent,
  readConfigSubscriptionText,
} from '@/lib/config-subscription';
import { db } from '@/lib/db';
import { fetchWithUrlGuard } from '@/lib/url-guard';

export async function refreshSubscribedConfig(): Promise<void> {
  const subscription = await db.getConfigSubscription();
  if (
    !subscription.ConfigSubscribtion.URL ||
    !subscription.ConfigSubscribtion.AutoUpdate
  ) {
    console.log('跳过刷新：未配置订阅地址或自动更新');
    return;
  }

  try {
    const response = await fetchWithUrlGuard(
      subscription.ConfigSubscribtion.URL,
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`请求失败: ${response.status} ${response.statusText}`);
    }
    const decodedContent = await decodeConfigSubscriptionContent(
      await readConfigSubscriptionText(response),
    );
    JSON.parse(decodedContent);
    const next = {
      ConfigFile: decodedContent,
      ConfigSubscribtion: {
        ...subscription.ConfigSubscribtion,
        LastCheck: new Date().toISOString(),
        FailureSince: '',
      },
    };
    invalidateConfigCache();
    const config = await getConfig();
    const before = JSON.stringify(config);
    refineConfig(config, decodedContent);
    const state = { subscription: { expected: subscription, next } };
    if (before !== JSON.stringify(config)) {
      await saveConfig(config, state);
    } else {
      // 原文与检查时间独立更新；配置 CAS 仅用于串行化并发操作，不改写 JSON。
      const current = await db.getAdminConfig();
      if (
        !current ||
        JSON.stringify(configSelfCheck(JSON.parse(JSON.stringify(current)))) !==
          before ||
        !(await db.compareAndSetAdminConfig(current, current, state))
      )
        throw new ConfigConflictError();
    }
  } catch (error) {
    console.error('刷新配置失败:', error);
    // 配置冲突由下一轮重试，不把用户同时编辑订阅判成回源失败。
    if (error instanceof ConfigConflictError) return;
    try {
      const current = await db.getAdminConfig();
      if (current) {
        await db.compareAndSetAdminConfig(current, current, {
          subscription: {
            expected: subscription,
            next: {
              ...subscription,
              ConfigSubscribtion: {
                ...subscription.ConfigSubscribtion,
                FailureSince:
                  subscription.ConfigSubscribtion.FailureSince ||
                  new Date().toISOString(),
              },
            },
          },
        });
      }
    } catch (stateError) {
      console.error('记录订阅更新状态失败:', stateError);
    }
  }
}
