import { getConfig, refineConfig, saveConfig } from '@/lib/config';
import {
  decodeConfigSubscriptionContent,
  readConfigSubscriptionText,
} from '@/lib/config-subscription';
import { fetchWithUrlGuard } from '@/lib/url-guard';

export async function refreshSubscribedConfig(): Promise<void> {
  let config = await getConfig();
  if (
    !config?.ConfigSubscribtion?.URL ||
    !config.ConfigSubscribtion.AutoUpdate
  ) {
    console.log('跳过刷新：未配置订阅地址或自动更新');
    return;
  }

  try {
    const response = await fetchWithUrlGuard(config.ConfigSubscribtion.URL);
    if (!response.ok) {
      throw new Error(`请求失败: ${response.status} ${response.statusText}`);
    }

    const configContent = await readConfigSubscriptionText(response);
    let decodedContent;
    try {
      decodedContent = await decodeConfigSubscriptionContent(configContent);
    } catch (decodeError) {
      console.warn('Base58 解码失败:', decodeError);
      throw decodeError;
    }

    try {
      JSON.parse(decodedContent);
    } catch {
      throw new Error('配置文件格式错误，请检查 JSON 语法');
    }

    config.ConfigFile = decodedContent;
    config.ConfigSubscribtion.LastCheck = new Date().toISOString();
    config = refineConfig(config);
    await saveConfig(config);
  } catch (error) {
    console.error('刷新配置失败:', error);
  }
}
