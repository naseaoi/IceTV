'use client';

import { ExternalLink, RotateCcw, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

import AdminSelect from '@/components/admin/AdminSelect';
import ConfirmModal from '@/components/modals/ConfirmModal';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell, { useDeferredClose } from '@/components/modals/ModalShell';
import { CustomProxyActions } from '@/components/proxy/CustomProxyActions';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import type { CustomProxyTestKind } from '@/lib/custom-proxy-test';
import {
  CUSTOM_PROXY_LABELS,
  getCustomProxyError,
  normalizeCustomProxyUrl,
  testCustomProxy,
} from '@/lib/custom-proxy-test';
import {
  clearDoubanImageProxyTypeCookie,
  writeDoubanImageProxyTypeCookie,
} from '@/lib/douban-image-url';
import {
  doubanDataSourceOptions,
  doubanImageProxyTypeOptions,
  getThanksInfo,
} from '@/lib/douban-options';
import {
  normalizeDoubanImageProxyType,
  normalizeDoubanProxyType,
  readDefaultDoubanImageProxyType,
  readDefaultDoubanImageProxyUrl,
  readDefaultDoubanProxyType,
  readDefaultDoubanProxyUrl,
  readDoubanImageProxyType,
  readDoubanImageProxyUrl,
  readDoubanProxyType,
  readDoubanProxyUrl,
  resetDoubanImageProxyType,
  resetDoubanImageProxyUrl,
  resetDoubanProxyType,
  resetDoubanProxyUrl,
  writeDoubanImageProxyType,
  writeDoubanImageProxyUrl,
  writeDoubanProxyType,
  writeDoubanProxyUrl,
} from '@/lib/douban-source';
import {
  localPreferenceToggleDefinitions,
  readLocalPreferenceToggleDefaultState,
  readLocalPreferenceToggleState,
  resetAllLocalPreferenceToggles,
} from '@/lib/local-preference-toggles';
import { showToast } from '@/lib/toast';

interface SettingsPanelProps {
  onClose: () => void;
}

type CustomProxyField = CustomProxyTestKind;

const SERVER_PROXY_DISABLED_REASON = '登录后可用';

interface InitialSettings {
  isAuthenticated: boolean;
  localPreferenceToggles: ReturnType<typeof readLocalPreferenceToggleState>;
  doubanDataSource: string;
  doubanProxyUrl: string;
  doubanImageProxyType: string;
  doubanImageProxyUrl: string;
}

// 面板只在用户打开时挂载，首帧直接读本地存储，避免默认值渲染后再替换造成跳动
function readInitialSettings(): InitialSettings {
  const isAuthenticated = Boolean(getAuthInfoFromBrowserCookie()?.username);
  const doubanProxyUrl = readDoubanProxyUrl();
  const doubanImageProxyUrl = readDoubanImageProxyUrl();
  return {
    isAuthenticated,
    localPreferenceToggles: readLocalPreferenceToggleState(),
    doubanDataSource: resolveInitialProxySource(
      readDoubanProxyType(),
      doubanProxyUrl,
      isAuthenticated,
    ),
    doubanProxyUrl,
    doubanImageProxyType: resolveInitialProxySource(
      readDoubanImageProxyType(),
      doubanImageProxyUrl,
      isAuthenticated,
    ),
    doubanImageProxyUrl,
  };
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [open, requestClose] = useDeferredClose(onClose);
  return (
    <ModalShell
      isOpen={open}
      onClose={requestClose}
      panelClassName='flex max-h-[85vh] max-w-xl flex-col overflow-hidden'
    >
      <SettingsPanelContent onClose={requestClose} />
    </ModalShell>
  );
}

function SettingsPanelContent({ onClose }: SettingsPanelProps) {
  const [initial] = useState(readInitialSettings);
  const { isAuthenticated } = initial;
  const [localPreferenceToggles, setLocalPreferenceToggles] = useState(
    initial.localPreferenceToggles,
  );
  const [doubanProxyUrl, setDoubanProxyUrl] = useState(initial.doubanProxyUrl);
  const [doubanDataSource, setDoubanDataSource] = useState(
    initial.doubanDataSource,
  );
  const [doubanImageProxyType, setDoubanImageProxyType] = useState(
    initial.doubanImageProxyType,
  );
  const [doubanImageProxyUrl, setDoubanImageProxyUrl] = useState(
    initial.doubanImageProxyUrl,
  );
  const [customProxyErrors, setCustomProxyErrors] = useState<
    Partial<Record<CustomProxyField, string>>
  >({});
  const [testingProxy, setTestingProxy] = useState<CustomProxyField | null>(
    null,
  );
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // 已选自定义代理但地址失效时，把存储里的来源一并清回默认
  useEffect(() => {
    if (isInvalidCustomProxy(readDoubanProxyType(), initial.doubanProxyUrl)) {
      resetDoubanProxyType();
    }
    if (
      isInvalidCustomProxy(
        readDoubanImageProxyType(),
        initial.doubanImageProxyUrl,
      )
    ) {
      resetDoubanImageProxyType();
    }
  }, [initial]);

  const doubanDataOptions = useMemo(
    () => markServerProxyOption(doubanDataSourceOptions, isAuthenticated),
    [isAuthenticated],
  );
  const doubanImageOptions = useMemo(
    () => markServerProxyOption(doubanImageProxyTypeOptions, isAuthenticated),
    [isAuthenticated],
  );

  const showProxyToast = () => {
    showToast('更换成功，刷新页面后生效', 'success');
  };

  const showLoginRequiredToast = () => {
    showToast('登录后可使用服务器请求', 'info');
  };

  const handleDoubanProxyUrlChange = (value: string) => {
    setDoubanProxyUrl(value);
    if (normalizeCustomProxyUrl(value)) {
      writeDoubanProxyUrl(value);
      if (doubanDataSource === 'custom') {
        writeDoubanProxyType('custom');
      }
    } else {
      resetDoubanProxyUrl();
      if (doubanDataSource === 'custom') {
        resetDoubanProxyType();
      }
    }
    setCustomProxyErrors((prev) => ({
      ...prev,
      'douban-data': getCustomProxyError('douban-data', value),
    }));
  };

  const handleLocalPreferenceToggle = (
    id: keyof typeof localPreferenceToggles,
    value: boolean,
  ) => {
    setLocalPreferenceToggles((prev) => ({
      ...prev,
      [id]: value,
    }));

    const definition = localPreferenceToggleDefinitions.find(
      (item) => item.id === id,
    );
    definition?.writeValue(value);
  };

  const handleDoubanDataSourceChange = (value: string) => {
    if (!canSelectProxyValue(value, isAuthenticated)) {
      showLoginRequiredToast();
      return;
    }
    const nextSource = normalizeDoubanProxyType(value);
    setDoubanDataSource(nextSource);
    if (nextSource === 'custom') {
      const error = getCustomProxyError('douban-data', doubanProxyUrl);
      setCustomProxyErrors((prev) => ({
        ...prev,
        'douban-data': error,
      }));
      if (error) {
        showToast(error, 'error');
        return;
      }
    }
    writeDoubanProxyType(nextSource);
    showProxyToast();
  };

  const handleDoubanImageProxyTypeChange = (value: string) => {
    if (!canSelectProxyValue(value, isAuthenticated)) {
      showLoginRequiredToast();
      return;
    }
    const nextSource = normalizeDoubanImageProxyType(value);
    setDoubanImageProxyType(nextSource);
    if (nextSource === 'custom') {
      const error = getCustomProxyError('douban-image', doubanImageProxyUrl);
      setCustomProxyErrors((prev) => ({
        ...prev,
        'douban-image': error,
      }));
      if (error) {
        showToast(error, 'error');
        return;
      }
    }
    writeDoubanImageProxyType(nextSource);
    writeDoubanImageProxyTypeCookie(nextSource);
    showProxyToast();
  };

  const handleDoubanImageProxyUrlChange = (value: string) => {
    setDoubanImageProxyUrl(value);
    if (normalizeCustomProxyUrl(value)) {
      writeDoubanImageProxyUrl(value);
      if (doubanImageProxyType === 'custom') {
        writeDoubanImageProxyType('custom');
        clearDoubanImageProxyTypeCookie();
      }
    } else {
      resetDoubanImageProxyUrl();
      if (doubanImageProxyType === 'custom') {
        resetDoubanImageProxyType();
        clearDoubanImageProxyTypeCookie();
      }
    }
    setCustomProxyErrors((prev) => ({
      ...prev,
      'douban-image': getCustomProxyError('douban-image', value),
    }));
  };

  const handleTestCustomProxy = async (
    kind: CustomProxyField,
    proxyUrl: string,
  ) => {
    const error = getCustomProxyError(kind, proxyUrl);
    if (error) {
      setCustomProxyErrors((prev) => ({ ...prev, [kind]: error }));
      showToast(error, 'error');
      return;
    }

    setTestingProxy(kind);
    try {
      await testCustomProxy(kind, proxyUrl);
      setCustomProxyErrors((prev) => ({ ...prev, [kind]: '' }));
      showToast(`测试通过，${CUSTOM_PROXY_LABELS[kind]}可用`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '代理测试失败';
      setCustomProxyErrors((prev) => ({ ...prev, [kind]: message }));
      showToast(`测试失败，${message}`, 'error');
    } finally {
      setTestingProxy(null);
    }
  };

  const handleResetSettings = () => {
    const defaultDoubanProxyType = readDefaultDoubanProxyType();
    const defaultDoubanProxy = readDefaultDoubanProxyUrl();
    const defaultDoubanImageProxyType = readDefaultDoubanImageProxyType();
    const defaultDoubanImageProxyUrl = readDefaultDoubanImageProxyUrl();
    const defaultLocalPreferenceToggles =
      readLocalPreferenceToggleDefaultState();

    setLocalPreferenceToggles(defaultLocalPreferenceToggles);
    setDoubanProxyUrl(defaultDoubanProxy);
    setDoubanDataSource(defaultDoubanProxyType);
    setDoubanImageProxyType(defaultDoubanImageProxyType);
    setDoubanImageProxyUrl(defaultDoubanImageProxyUrl);

    resetAllLocalPreferenceToggles();
    resetDoubanProxyUrl();
    resetDoubanProxyType();
    resetDoubanImageProxyType();
    resetDoubanImageProxyUrl();
    clearDoubanImageProxyTypeCookie();
    setCustomProxyErrors({});
  };

  return (
    <>
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='local-settings-title'
        className='flex min-h-0 flex-1 flex-col'
      >
        <div className='flex items-center justify-between gap-3 border-b border-gray-200/70 py-3 pl-5 pr-3 dark:border-white/[0.06]'>
          <h3 id='local-settings-title' className={MODAL_TITLE_CLASS}>
            本地设置
          </h3>
          <div className='flex items-center gap-1'>
            <button
              type='button'
              onClick={() => setShowResetConfirm(true)}
              className='inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] text-gray-500 transition-colors hover:bg-gray-900/[0.05] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
            >
              <RotateCcw className='h-3.5 w-3.5' />
              恢复默认
            </button>
            <button
              type='button'
              onClick={onClose}
              className={MODAL_CLOSE_BUTTON_CLASS}
              aria-label='关闭'
            >
              <X className='h-4 w-4' />
            </button>
          </div>
        </div>

        <div
          className='flex-1 space-y-6 overflow-y-auto px-5 pb-6 pt-4'
          data-panel-content
          style={{
            touchAction: 'pan-y',
            overscrollBehavior: 'contain',
          }}
        >
          <SettingsSection title='数据来源'>
            <SettingsRow
              title='豆瓣数据代理'
              thanks={getThanksInfo(doubanDataSource)}
              control={
                <AdminSelect
                  value={doubanDataSource}
                  onChange={(value) => handleDoubanDataSourceChange(value)}
                  options={doubanDataOptions}
                />
              }
            >
              {doubanDataSource === 'custom' && (
                <CustomProxyField
                  id='local-douban-proxy-url'
                  name='localDoubanProxyUrl'
                  label='豆瓣代理地址'
                  value={doubanProxyUrl}
                  error={customProxyErrors['douban-data']}
                  isTesting={testingProxy === 'douban-data'}
                  onChange={handleDoubanProxyUrlChange}
                  onTest={() =>
                    handleTestCustomProxy('douban-data', doubanProxyUrl)
                  }
                />
              )}
            </SettingsRow>

            <SettingsRow
              title='豆瓣图片代理'
              thanks={getThanksInfo(doubanImageProxyType)}
              control={
                <AdminSelect
                  value={doubanImageProxyType}
                  onChange={(value) => handleDoubanImageProxyTypeChange(value)}
                  options={doubanImageOptions}
                />
              }
            >
              {doubanImageProxyType === 'custom' && (
                <CustomProxyField
                  id='local-douban-image-proxy-url'
                  name='localDoubanImageProxyUrl'
                  label='豆瓣图片代理地址'
                  value={doubanImageProxyUrl}
                  error={customProxyErrors['douban-image']}
                  isTesting={testingProxy === 'douban-image'}
                  onChange={handleDoubanImageProxyUrlChange}
                  onTest={() =>
                    handleTestCustomProxy('douban-image', doubanImageProxyUrl)
                  }
                />
              )}
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title='功能'>
            {localPreferenceToggleDefinitions.map((definition) => (
              <label
                key={definition.id}
                htmlFor={`local-${definition.id}`}
                className='flex cursor-pointer items-center justify-between gap-6 py-3.5'
              >
                <span className='min-w-0'>
                  <span className='block text-sm text-gray-900 dark:text-gray-100'>
                    {definition.title}
                  </span>
                  <span className='mt-0.5 block text-xs text-gray-400 dark:text-gray-500'>
                    {definition.description}
                  </span>
                </span>
                <span className='relative shrink-0'>
                  <input
                    id={`local-${definition.id}`}
                    name={definition.id}
                    type='checkbox'
                    className='peer sr-only'
                    checked={localPreferenceToggles[definition.id]}
                    onChange={(event) =>
                      handleLocalPreferenceToggle(
                        definition.id,
                        event.target.checked,
                      )
                    }
                  />
                  <span className='block h-6 w-10 rounded-full bg-gray-200 transition-colors peer-checked:bg-brand-500 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/40 dark:bg-white/[0.12]' />
                  <span className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4' />
                </span>
              </label>
            ))}
          </SettingsSection>
        </div>
      </div>
      <ConfirmModal
        isOpen={showResetConfirm}
        title='确认恢复默认设置？'
        message='该操作会清空当前浏览器中的本地设置，并恢复为默认值。'
        danger
        cancelText='取消'
        confirmText='确认恢复'
        onCancel={() => setShowResetConfirm(false)}
        onConfirm={handleResetSettings}
      />
    </>
  );
}

function markServerProxyOption<T extends { value: string; label: string }>(
  options: T[],
  isAuthenticated: boolean,
) {
  return options.map((option) =>
    option.value === 'server' && !isAuthenticated
      ? {
          ...option,
          disabled: true,
          disabledReason: SERVER_PROXY_DISABLED_REASON,
        }
      : option,
  );
}

function canSelectProxyValue(value: string, isAuthenticated: boolean): boolean {
  return value !== 'server' || isAuthenticated;
}

function isInvalidCustomProxy(source: string, proxyUrl: string) {
  return source === 'custom' && !normalizeCustomProxyUrl(proxyUrl);
}

function resolveInitialProxySource(
  source: string,
  proxyUrl: string,
  isAuthenticated: boolean,
): string {
  if (source === 'server' && !isAuthenticated) {
    return 'direct';
  }
  if (isInvalidCustomProxy(source, proxyUrl)) {
    return 'direct';
  }
  return source;
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h4 className='text-xs font-medium text-gray-400 dark:text-gray-500'>
        {title}
      </h4>
      <div className='divide-y divide-gray-200/70 dark:divide-white/[0.06]'>
        {children}
      </div>
    </section>
  );
}

function SettingsRow({
  title,
  thanks,
  control,
  children,
}: {
  title: string;
  thanks?: { text: string; url: string } | null;
  control: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className='py-3.5'>
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6'>
        <div className='min-w-0 sm:shrink-0'>
          <div className='text-sm text-gray-900 dark:text-gray-100'>
            {title}
          </div>
          {thanks && (
            <a
              href={thanks.url}
              target='_blank'
              rel='noopener noreferrer'
              className='mt-0.5 inline-flex items-center gap-1 text-xs text-gray-400 transition-colors hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300'
            >
              {thanks.text}
              <ExternalLink className='h-3 w-3' />
            </a>
          )}
        </div>
        <div className='w-full sm:min-w-0 sm:max-w-xs sm:flex-1'>{control}</div>
      </div>
      {children}
    </div>
  );
}

function CustomProxyField({
  id,
  name,
  label,
  value,
  error,
  isTesting,
  onChange,
  onTest,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  error?: string;
  isTesting: boolean;
  onChange: (value: string) => void;
  onTest: () => void;
}) {
  return (
    <div className='mt-3'>
      <div className='flex items-center gap-2'>
        <input
          id={id}
          name={name}
          type='text'
          aria-label={label}
          aria-invalid={error ? true : undefined}
          className='h-[42px] min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors hover:border-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:hover:border-gray-500'
          placeholder='例如: https://proxy.example.com/fetch?url='
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <CustomProxyActions isTesting={isTesting} onTest={onTest} />
      </div>
      {error && (
        <p className='mt-1.5 text-xs text-rose-500 dark:text-rose-400'>
          {error}
        </p>
      )}
    </div>
  );
}
