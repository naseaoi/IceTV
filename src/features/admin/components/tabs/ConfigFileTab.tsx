'use client';

import { useEffect, useState } from 'react';

import AlertModal from '@/features/admin/components/AlertModal';
import { useAlertModal } from '@/features/admin/hooks/useAlertModal';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { adminPost } from '@/features/admin/lib/api';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { showError, showSuccess } from '@/features/admin/lib/notifications';
import { AdminConfig } from '@/features/admin/types/api';

const ConfigFileComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [configContent, setConfigContent] = useState('');
  const [subscriptionUrl, setSubscriptionUrl] = useState('');
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<string>('');

  useEffect(() => {
    if (config?.ConfigFile) {
      setConfigContent(config.ConfigFile);
    }
    if (config?.ConfigSubscribtion) {
      setSubscriptionUrl(config.ConfigSubscribtion.URL);
      setAutoUpdate(config.ConfigSubscribtion.AutoUpdate);
      setLastCheckTime(config.ConfigSubscribtion.LastCheck || '');
    }
  }, [config]);

  // 拉取订阅配置
  const handleFetchConfig = async () => {
    if (!subscriptionUrl.trim()) {
      showError('请输入订阅URL', showAlert);
      return;
    }

    await withLoading('fetchConfig', async () => {
      try {
        const data = await adminPost<{ configContent?: string }>(
          '/api/admin/config_subscription/fetch',
          { url: subscriptionUrl },
          '拉取失败',
        );
        if (data.configContent) {
          setConfigContent(data.configContent);
          // 更新本地配置的最后检查时间
          const currentTime = new Date().toISOString();
          setLastCheckTime(currentTime);
          showSuccess('配置拉取成功', showAlert);
        } else {
          showError('拉取失败：未获取到配置内容', showAlert);
        }
      } catch (err) {
        showError(err instanceof Error ? err.message : '拉取失败', showAlert);
        throw err;
      }
    });
  };

  // 保存配置文件
  const handleSave = async () => {
    await withLoading('saveConfig', async () => {
      try {
        await adminPost(
          '/api/admin/config_file',
          {
            configFile: configContent,
            subscriptionUrl,
            autoUpdate,
            lastCheckTime: lastCheckTime || new Date().toISOString(),
          },
          '保存失败',
        );

        showSuccess('配置文件保存成功', showAlert);
        await refreshConfig();
      } catch (err) {
        showError(err instanceof Error ? err.message : '保存失败', showAlert);
        throw err;
      }
    });
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
        {/* 配置订阅区域 */}
        <div className='bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 shadow-sm'>
          <div className='flex items-center justify-between mb-6'>
            <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
              配置订阅
            </h3>
            <div className='text-sm text-gray-500 dark:text-gray-400 px-3 py-1.5 rounded-full'>
              最后更新:{' '}
              {lastCheckTime
                ? new Date(lastCheckTime).toLocaleString('zh-CN')
                : '从未更新'}
            </div>
          </div>

          <div className='space-y-6'>
            {/* 订阅URL输入 */}
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
                订阅URL
              </label>
              <input
                type='url'
                value={subscriptionUrl}
                onChange={(e) => setSubscriptionUrl(e.target.value)}
                placeholder='https://example.com/config.json'
                disabled={false}
                className='w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
              />
              <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
                输入配置文件的订阅地址，要求 JSON 格式，且使用 Base58 编码
              </p>
            </div>

            {/* 拉取配置按钮 */}
            <div className='pt-2'>
              <button
                onClick={handleFetchConfig}
                disabled={isLoading('fetchConfig') || !subscriptionUrl.trim()}
                className={`w-full px-6 py-3 rounded-lg font-medium transition-all duration-200 ${
                  isLoading('fetchConfig') || !subscriptionUrl.trim()
                    ? buttonStyles.disabled
                    : buttonStyles.success
                }`}
              >
                {isLoading('fetchConfig') ? (
                  <div className='flex items-center justify-center gap-2'>
                    <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                    拉取中…
                  </div>
                ) : (
                  '拉取配置'
                )}
              </button>
            </div>

            {/* 自动更新开关 */}
            <div className='flex items-center justify-between'>
              <div>
                <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  自动更新
                </label>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  启用后系统将定期自动拉取最新配置
                </p>
              </div>
              <button
                type='button'
                onClick={() => setAutoUpdate(!autoUpdate)}
                disabled={false}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                  autoUpdate ? buttonStyles.toggleOn : buttonStyles.toggleOff
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full ${
                    buttonStyles.toggleThumb
                  } transition-transform ${
                    autoUpdate
                      ? buttonStyles.toggleThumbOn
                      : buttonStyles.toggleThumbOff
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* 配置文件编辑区域 */}
        <div className='space-y-4 bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 shadow-sm'>
          <div className='relative'>
            <textarea
              value={configContent}
              onChange={(e) => setConfigContent(e.target.value)}
              rows={20}
              placeholder='请输入配置文件内容（JSON 格式）...'
              disabled={false}
              className='w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm leading-relaxed resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 hover:border-gray-400 dark:hover:border-gray-500'
              style={{
                fontFamily:
                  'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
              }}
              spellCheck={false}
              data-gramm={false}
            />
          </div>

          <div className='flex items-center justify-between'>
            <div className='text-xs text-gray-500 dark:text-gray-400'>
              支持 JSON 格式，用于配置视频源和自定义分类
            </div>
            <button
              onClick={handleSave}
              disabled={isLoading('saveConfig')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                isLoading('saveConfig')
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('saveConfig') ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>

      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};

export default ConfigFileComponent;
