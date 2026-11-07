'use client';
import { Download, RefreshCw, Upload } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import AlertModal from '@/components/modals/AlertModal';
import Spinner from '@/components/Spinner';
import {
  AdminSettingRow,
  AdminSettingsGroup,
} from '@/features/admin/components/AdminSettings';
import { AdminStatusSwitch } from '@/features/admin/components/AdminStatusSwitch';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { CONFIG_FILE_FORM_ID } from '@/features/admin/lib/admin-form-ids';
import { adminPost } from '@/features/admin/lib/api';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { showError, showSuccess } from '@/features/admin/lib/notifications';
import { useAlertModal } from '@/hooks/useAlertModal';
import { buildConfigFileFromAdminConfig } from '@/lib/config-file-json';
import { AdminConfig } from '@/types/admin';

const CONFIG_SUBSCRIPTION_URL_ID = 'config-subscription-url';
const CONFIG_FILE_CONTENT_ID = 'config-file-content';
const CONFIG_FILE_INPUT_ID = 'config-file-import';
const CONFIG_FILE_MAX_SIZE = 5 * 1024 * 1024;

interface ConfigFileDraft {
  configContent: string;
  subscriptionUrl: string;
  autoUpdate: boolean;
  lastCheckTime: string;
}

const ConfigFileComponent = ({
  config,
  refreshConfig,
  onSavingChange,
  onDirtyChange,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
  onSavingChange?: (saving: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [configContent, setConfigContent] = useState('');
  const [subscriptionUrl, setSubscriptionUrl] = useState('');
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<string>('');
  const [baselineDraft, setBaselineDraft] = useState<ConfigFileDraft>({
    configContent: '',
    subscriptionUrl: '',
    autoUpdate: false,
    lastCheckTime: '',
  });
  const savingRef = useRef(false);
  const configFileInputRef = useRef<HTMLInputElement>(null);
  const currentDraft: ConfigFileDraft = {
    configContent,
    subscriptionUrl,
    autoUpdate,
    lastCheckTime,
  };
  const configFileDirty =
    JSON.stringify(currentDraft) !== JSON.stringify(baselineDraft);
  const hasUnsavedFetchTime = lastCheckTime !== baselineDraft.lastCheckTime;

  useEffect(() => {
    if (config) {
      const nextDraft = {
        configContent: buildConfigFileFromAdminConfig(
          config,
          config.ConfigFile,
        ),
        subscriptionUrl: config.ConfigSubscribtion?.URL || '',
        autoUpdate: config.ConfigSubscribtion?.AutoUpdate || false,
        lastCheckTime: config.ConfigSubscribtion?.LastCheck || '',
      };
      setConfigContent(nextDraft.configContent);
      setSubscriptionUrl(nextDraft.subscriptionUrl);
      setAutoUpdate(nextDraft.autoUpdate);
      setLastCheckTime(nextDraft.lastCheckTime);
      setBaselineDraft(nextDraft);
    }
  }, [config]);

  useEffect(() => {
    onDirtyChange?.(configFileDirty);
  }, [configFileDirty, onDirtyChange]);

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
          try {
            JSON.parse(data.configContent);
          } catch {
            throw new Error('订阅内容不是有效的 JSON');
          }
          setConfigContent(data.configContent);
          const currentTime = new Date().toISOString();
          setLastCheckTime(currentTime);
          showSuccess('配置拉取成功');
        } else {
          showError('拉取失败：未获取到配置内容', showAlert);
        }
      } catch (err) {
        showError(err instanceof Error ? err.message : '拉取失败', showAlert);
        throw err;
      }
    });
  };

  const handleSave = async () => {
    if (savingRef.current || !configFileDirty) return;
    savingRef.current = true;
    onSavingChange?.(true);
    await withLoading('saveConfig', async () => {
      try {
        await adminPost(
          '/api/admin/config_file',
          {
            configFile: configContent,
            subscriptionUrl,
            autoUpdate,
            lastCheckTime,
          },
          '保存失败',
        );

        setBaselineDraft(currentDraft);
        showSuccess('配置文件保存成功');
        await refreshConfig();
      } catch (err) {
        showError(err instanceof Error ? err.message : '保存失败', showAlert);
        throw err;
      }
    }).finally(() => {
      savingRef.current = false;
      onSavingChange?.(false);
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSave();
  };

  const handleExport = () => {
    if (!configContent.trim()) {
      showError('配置文件内容为空', showAlert);
      return;
    }
    try {
      JSON.parse(configContent);
    } catch {
      showError('当前内容不是有效的 JSON，无法导出', showAlert);
      return;
    }

    const blob = new Blob([configContent], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+$/, '');
    link.href = url;
    link.download = `icetv-config-${timestamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showSuccess('配置文件已导出');
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      showError('只支持导入 JSON 文件', showAlert);
      return;
    }
    if (file.size > CONFIG_FILE_MAX_SIZE) {
      showError('JSON 文件不能超过 5MB', showAlert);
      return;
    }

    try {
      const content = await file.text();
      JSON.parse(content);
      setConfigContent(content);
      showSuccess('JSON 已导入，请保存后生效');
    } catch {
      showError('JSON 文件格式错误', showAlert);
    }
  };

  if (!config) return null;

  const fetching = isLoading('fetchConfig');

  return (
    <form
      id={CONFIG_FILE_FORM_ID}
      onSubmit={handleSubmit}
      className='space-y-8'
    >
      <AdminSettingsGroup
        title='配置订阅'
        actions={
          <span className='text-xs text-gray-500 dark:text-gray-400'>
            {hasUnsavedFetchTime ? '本次拉取' : '最后更新'}{' '}
            {lastCheckTime
              ? new Date(lastCheckTime).toLocaleString('zh-CN')
              : '从未更新'}
          </span>
        }
      >
        <AdminSettingRow label='订阅地址' htmlFor={CONFIG_SUBSCRIPTION_URL_ID}>
          <div className='flex w-full gap-2 sm:w-96'>
            <input
              id={CONFIG_SUBSCRIPTION_URL_ID}
              name='subscriptionUrl'
              type='url'
              value={subscriptionUrl}
              onChange={(e) => setSubscriptionUrl(e.target.value)}
              placeholder='https://example.com/config.json'
              className={`h-9 min-w-0 flex-1 ${inputStyles.withFocus}`}
            />
            <button
              type='button'
              onClick={handleFetchConfig}
              disabled={fetching || !subscriptionUrl.trim()}
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${buttonStyles.outline}`}
            >
              {fetching ? (
                <Spinner className='h-3.5 w-3.5' />
              ) : (
                <RefreshCw aria-hidden='true' className='h-3.5 w-3.5' />
              )}
              {fetching ? '拉取中' : '拉取'}
            </button>
          </div>
        </AdminSettingRow>
        <AdminSettingRow label='自动更新' layout='inline'>
          <AdminStatusSwitch
            enabled={autoUpdate}
            ariaLabel='切换配置自动更新'
            onToggle={() => setAutoUpdate(!autoUpdate)}
          />
        </AdminSettingRow>
      </AdminSettingsGroup>

      <AdminSettingsGroup
        title='配置内容'
        actions={
          <>
            <input
              ref={configFileInputRef}
              id={CONFIG_FILE_INPUT_ID}
              type='file'
              accept='.json,application/json'
              className='hidden'
              onChange={handleImport}
            />
            <button
              type='button'
              onClick={() => configFileInputRef.current?.click()}
              className={`inline-flex items-center gap-1.5 ${buttonStyles.outline}`}
            >
              <Upload aria-hidden='true' className='h-3.5 w-3.5' />
              导入
            </button>
            <button
              type='button'
              onClick={handleExport}
              disabled={!configContent.trim()}
              className={`inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${buttonStyles.outline}`}
            >
              <Download aria-hidden='true' className='h-3.5 w-3.5' />
              导出
            </button>
          </>
        }
      >
        <label htmlFor={CONFIG_FILE_CONTENT_ID} className='sr-only'>
          配置文件内容
        </label>
        <textarea
          id={CONFIG_FILE_CONTENT_ID}
          name='configFileContent'
          value={configContent}
          onChange={(e) => setConfigContent(e.target.value)}
          placeholder='{ "api_site": {}, "custom_category": [] }'
          spellCheck={false}
          data-gramm={false}
          className='block min-h-[32rem] w-full resize-y rounded-xl border-0 bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 dark:text-gray-100'
        />
      </AdminSettingsGroup>

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </form>
  );
};

export default ConfigFileComponent;
