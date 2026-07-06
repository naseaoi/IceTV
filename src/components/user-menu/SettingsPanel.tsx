'use client';

import { ExternalLink, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import AdminSelect from '@/components/admin/AdminSelect';
import AlertModal from '@/components/modals/AlertModal';
import ConfirmModal from '@/components/modals/ConfirmModal';
import { CustomProxyActions } from '@/components/proxy/CustomProxyActions';
import { useAlertModal } from '@/hooks/useAlertModal';
import {
  BANGUMI_DATA_SOURCE_STORAGE_KEY,
  BANGUMI_PROXY_URL_STORAGE_KEY,
  DEFAULT_BANGUMI_DATA_SOURCE,
  bangumiDataSourceOptions,
  normalizeBangumiDataSource,
  readDefaultBangumiDataSource,
  readDefaultBangumiProxyUrl,
  readBangumiDataSource,
  readBangumiProxyUrl,
} from '@/lib/bangumi-source';
import {
  doubanDataSourceOptions,
  doubanImageProxyTypeOptions,
  getThanksInfo,
} from '@/lib/douban-options';
import {
  DOUBAN_DATA_SOURCE_STORAGE_KEY,
  DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY,
  DOUBAN_IMAGE_PROXY_URL_STORAGE_KEY,
  DOUBAN_PROXY_URL_STORAGE_KEY,
  readDefaultDoubanImageProxyType,
  readDefaultDoubanImageProxyUrl,
  readDoubanImageProxyType,
  readDoubanImageProxyUrl,
  readDefaultDoubanProxyType,
  readDefaultDoubanProxyUrl,
  readDoubanProxyType,
  readDoubanProxyUrl,
} from '@/lib/douban-source';
import {
  localPreferenceToggleDefinitions,
  readLocalPreferenceToggleDefaultState,
  readLocalPreferenceToggleState,
  resetAllLocalPreferenceToggles,
} from '@/lib/local-preference-toggles';
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

import { useBodyScrollLock } from './useBodyScrollLock';

interface SettingsPanelProps {
  onClose: () => void;
}

type CustomProxyField = CustomProxyTestKind;

const SERVER_PROXY_DISABLED_REASON = '登录后可用';

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const helperTextClassName = 'mt-1 text-xs text-gray-400 dark:text-gray-500';
  const [localPreferenceToggles, setLocalPreferenceToggles] = useState(
    readLocalPreferenceToggleDefaultState,
  );
  const [doubanProxyUrl, setDoubanProxyUrl] = useState('');
  const [doubanDataSource, setDoubanDataSource] = useState('direct');
  const [bangumiDataSource, setBangumiDataSource] = useState(
    DEFAULT_BANGUMI_DATA_SOURCE,
  );
  const [bangumiProxyUrl, setBangumiProxyUrl] = useState('');
  const [doubanImageProxyType, setDoubanImageProxyType] = useState('direct');
  const [doubanImageProxyUrl, setDoubanImageProxyUrl] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [customProxyErrors, setCustomProxyErrors] = useState<
    Partial<Record<CustomProxyField, string>>
  >({});
  const [testingProxy, setTestingProxy] = useState<CustomProxyField | null>(
    null,
  );
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const { alertModal, showAlert, hideAlert } = useAlertModal();

  useBodyScrollLock(true);

  useEffect(() => {
    const loggedIn = Boolean(getAuthInfoFromBrowserCookie()?.username);
    const nextDoubanSource = readDoubanProxyType();
    const nextDoubanProxyUrl = readDoubanProxyUrl();
    const nextBangumiSource = readBangumiDataSource();
    const nextBangumiProxyUrl = readBangumiProxyUrl();
    const nextDoubanImageSource = readDoubanImageProxyType();
    const nextDoubanImageProxyUrl = readDoubanImageProxyUrl();
    const resolvedDoubanSource = resolveInitialProxySource(
      nextDoubanSource,
      nextDoubanProxyUrl,
      loggedIn,
      DOUBAN_DATA_SOURCE_STORAGE_KEY,
    );
    const resolvedBangumiSource = resolveInitialProxySource(
      nextBangumiSource,
      nextBangumiProxyUrl,
      loggedIn,
      BANGUMI_DATA_SOURCE_STORAGE_KEY,
    );
    const resolvedDoubanImageSource = resolveInitialProxySource(
      nextDoubanImageSource,
      nextDoubanImageProxyUrl,
      loggedIn,
      DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY,
    );

    setIsAuthenticated(loggedIn);
    setLocalPreferenceToggles(readLocalPreferenceToggleState());

    setDoubanDataSource(resolvedDoubanSource);
    setDoubanProxyUrl(nextDoubanProxyUrl);
    setBangumiDataSource(normalizeBangumiDataSource(resolvedBangumiSource));
    setBangumiProxyUrl(nextBangumiProxyUrl);

    setDoubanImageProxyType(resolvedDoubanImageSource);
    setDoubanImageProxyUrl(nextDoubanImageProxyUrl);
  }, []);

  const doubanDataOptions = useMemo(
    () => markServerProxyOption(doubanDataSourceOptions, isAuthenticated),
    [isAuthenticated],
  );
  const doubanImageOptions = useMemo(
    () => markServerProxyOption(doubanImageProxyTypeOptions, isAuthenticated),
    [isAuthenticated],
  );
  const bangumiOptions = useMemo(
    () => markServerProxyOption(bangumiDataSourceOptions, isAuthenticated),
    [isAuthenticated],
  );

  const showProxyToast = () => {
    showAlert({
      type: 'success',
      title: '更换成功',
      message: '刷新页面后生效',
      timer: 2000,
    });
  };

  const showLoginRequiredToast = () => {
    showAlert({
      type: 'warning',
      title: '登录后可用',
      message: '服务器请求会消耗本站资源，请登录后使用。',
      timer: 2400,
    });
  };

  const handleDoubanProxyUrlChange = (value: string) => {
    setDoubanProxyUrl(value);
    if (normalizeCustomProxyUrl(value)) {
      localStorage.setItem(DOUBAN_PROXY_URL_STORAGE_KEY, value);
      if (doubanDataSource === 'custom') {
        localStorage.setItem(DOUBAN_DATA_SOURCE_STORAGE_KEY, 'custom');
      }
    } else {
      localStorage.removeItem(DOUBAN_PROXY_URL_STORAGE_KEY);
      if (doubanDataSource === 'custom') {
        localStorage.removeItem(DOUBAN_DATA_SOURCE_STORAGE_KEY);
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
    setDoubanDataSource(value);
    if (value === 'custom') {
      const error = getCustomProxyError('douban-data', doubanProxyUrl);
      setCustomProxyErrors((prev) => ({
        ...prev,
        'douban-data': error,
      }));
      if (error) {
        showAlert({
          type: 'warning',
          title: '代理地址必填',
          message: error,
          timer: 2200,
        });
        return;
      }
    }
    localStorage.setItem(DOUBAN_DATA_SOURCE_STORAGE_KEY, value);
    showProxyToast();
  };

  const handleBangumiDataSourceChange = (value: string) => {
    const nextSource = normalizeBangumiDataSource(value);
    if (!canSelectProxyValue(nextSource, isAuthenticated)) {
      showLoginRequiredToast();
      return;
    }
    setBangumiDataSource(nextSource);
    if (nextSource === 'custom') {
      const error = getCustomProxyError('bangumi', bangumiProxyUrl);
      setCustomProxyErrors((prev) => ({
        ...prev,
        bangumi: error,
      }));
      if (error) {
        showAlert({
          type: 'warning',
          title: '代理地址必填',
          message: error,
          timer: 2200,
        });
        return;
      }
    }
    localStorage.setItem(BANGUMI_DATA_SOURCE_STORAGE_KEY, nextSource);
    showProxyToast();
  };

  const handleBangumiProxyUrlChange = (value: string) => {
    setBangumiProxyUrl(value);
    if (normalizeCustomProxyUrl(value)) {
      localStorage.setItem(BANGUMI_PROXY_URL_STORAGE_KEY, value);
      if (bangumiDataSource === 'custom') {
        localStorage.setItem(BANGUMI_DATA_SOURCE_STORAGE_KEY, 'custom');
      }
    } else {
      localStorage.removeItem(BANGUMI_PROXY_URL_STORAGE_KEY);
      if (bangumiDataSource === 'custom') {
        localStorage.removeItem(BANGUMI_DATA_SOURCE_STORAGE_KEY);
      }
    }
    setCustomProxyErrors((prev) => ({
      ...prev,
      bangumi: getCustomProxyError('bangumi', value),
    }));
  };

  const handleDoubanImageProxyTypeChange = (value: string) => {
    if (!canSelectProxyValue(value, isAuthenticated)) {
      showLoginRequiredToast();
      return;
    }
    setDoubanImageProxyType(value);
    if (value === 'custom') {
      const error = getCustomProxyError('douban-image', doubanImageProxyUrl);
      setCustomProxyErrors((prev) => ({
        ...prev,
        'douban-image': error,
      }));
      if (error) {
        showAlert({
          type: 'warning',
          title: '代理地址必填',
          message: error,
          timer: 2200,
        });
        return;
      }
    }
    localStorage.setItem(DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY, value);
    writeDoubanImageProxyTypeCookie(value);
    showProxyToast();
  };

  const handleDoubanImageProxyUrlChange = (value: string) => {
    setDoubanImageProxyUrl(value);
    if (normalizeCustomProxyUrl(value)) {
      localStorage.setItem(DOUBAN_IMAGE_PROXY_URL_STORAGE_KEY, value);
      if (doubanImageProxyType === 'custom') {
        localStorage.setItem(DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY, 'custom');
        clearDoubanImageProxyTypeCookie();
      }
    } else {
      localStorage.removeItem(DOUBAN_IMAGE_PROXY_URL_STORAGE_KEY);
      if (doubanImageProxyType === 'custom') {
        localStorage.removeItem(DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY);
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
      showAlert({
        type: 'warning',
        title: '代理地址必填',
        message: error,
        timer: 2200,
      });
      return;
    }

    setTestingProxy(kind);
    try {
      await testCustomProxy(kind, proxyUrl);
      setCustomProxyErrors((prev) => ({ ...prev, [kind]: '' }));
      showAlert({
        type: 'success',
        title: '测试通过',
        message: `${CUSTOM_PROXY_LABELS[kind]}可用`,
        timer: 2200,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '代理测试失败';
      setCustomProxyErrors((prev) => ({ ...prev, [kind]: message }));
      showAlert({
        type: 'error',
        title: '测试失败',
        message,
        timer: 3000,
      });
    } finally {
      setTestingProxy(null);
    }
  };

  const handleResetSettings = () => {
    const defaultDoubanProxyType = readDefaultDoubanProxyType();
    const defaultDoubanProxy = readDefaultDoubanProxyUrl();
    const defaultDoubanImageProxyType = readDefaultDoubanImageProxyType();
    const defaultDoubanImageProxyUrl = readDefaultDoubanImageProxyUrl();
    const defaultBangumiDataSource = readDefaultBangumiDataSource();
    const defaultBangumiProxy = readDefaultBangumiProxyUrl();
    const defaultLocalPreferenceToggles =
      readLocalPreferenceToggleDefaultState();

    setLocalPreferenceToggles(defaultLocalPreferenceToggles);
    setDoubanProxyUrl(defaultDoubanProxy);
    setDoubanDataSource(defaultDoubanProxyType);
    setBangumiDataSource(defaultBangumiDataSource);
    setBangumiProxyUrl(defaultBangumiProxy);
    setDoubanImageProxyType(defaultDoubanImageProxyType);
    setDoubanImageProxyUrl(defaultDoubanImageProxyUrl);

    resetAllLocalPreferenceToggles();
    localStorage.removeItem(DOUBAN_PROXY_URL_STORAGE_KEY);
    localStorage.removeItem(DOUBAN_DATA_SOURCE_STORAGE_KEY);
    localStorage.removeItem(BANGUMI_DATA_SOURCE_STORAGE_KEY);
    localStorage.removeItem(BANGUMI_PROXY_URL_STORAGE_KEY);
    localStorage.removeItem(DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY);
    localStorage.removeItem(DOUBAN_IMAGE_PROXY_URL_STORAGE_KEY);
    clearDoubanImageProxyTypeCookie();
    setCustomProxyErrors({});
  };

  return (
    <>
      <div
        className='fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm'
        onClick={onClose}
        onTouchMove={(event) => event.preventDefault()}
        onWheel={(event) => event.preventDefault()}
        style={{
          touchAction: 'none',
        }}
      />

      <div className='fixed left-1/2 top-1/2 z-[1001] flex max-h-[90vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-gray-200/70 bg-white/80 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/70 dark:ring-white/10'>
        <div
          className='flex-1 overflow-y-auto p-6'
          data-panel-content
          style={{
            touchAction: 'pan-y',
            overscrollBehavior: 'contain',
          }}
        >
          <div className='mb-6 flex items-center justify-between'>
            <div>
              <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                本地设置
              </h3>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                设置保存在本地浏览器中
              </p>
            </div>
            <div className='flex items-center gap-2'>
              <button
                onClick={() => setShowResetConfirm(true)}
                className='flex h-8 w-8 items-center justify-center rounded-full p-1 text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300'
                title='重置为默认设置'
                aria-label='重置为默认设置'
              >
                <RotateCcw className='h-4 w-4' />
              </button>
              <button
                onClick={onClose}
                className='flex h-8 w-8 items-center justify-center rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800'
                aria-label='Close'
              >
                <X className='h-full w-full' />
              </button>
            </div>
          </div>

          <div className='space-y-6'>
            <div className='space-y-3'>
              <div>
                <div className='flex items-baseline justify-between gap-2'>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    豆瓣数据代理
                  </h4>
                  {getThanksInfo(doubanDataSource) && (
                    <button
                      type='button'
                      onClick={() =>
                        window.open(
                          getThanksInfo(doubanDataSource)!.url,
                          '_blank',
                        )
                      }
                      className='flex shrink-0 cursor-pointer items-center gap-1 text-[11px] leading-none text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
                    >
                      <span className='font-medium'>
                        {getThanksInfo(doubanDataSource)!.text}
                      </span>
                      <ExternalLink className='h-3 w-3 opacity-70' />
                    </button>
                  )}
                </div>
              </div>
              <AdminSelect
                value={doubanDataSource}
                onChange={(value) => handleDoubanDataSourceChange(value)}
                options={doubanDataOptions}
              />
            </div>

            {doubanDataSource === 'custom' && (
              <div className='space-y-2'>
                <div className='flex items-center justify-between gap-3'>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    豆瓣代理地址
                  </h4>
                  {customProxyErrors['douban-data'] && (
                    <p className='truncate text-xs text-rose-500 dark:text-rose-400'>
                      {customProxyErrors['douban-data']}
                    </p>
                  )}
                </div>
                <div className='flex items-center gap-2'>
                  <input
                    id='local-douban-proxy-url'
                    name='localDoubanProxyUrl'
                    type='text'
                    className='min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-500 shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 dark:hover:border-gray-500'
                    placeholder='例如: https://proxy.example.com/fetch?url='
                    value={doubanProxyUrl}
                    onChange={(event) =>
                      handleDoubanProxyUrlChange(event.target.value)
                    }
                  />
                  <CustomProxyActions
                    isTesting={testingProxy === 'douban-data'}
                    onTest={() =>
                      handleTestCustomProxy('douban-data', doubanProxyUrl)
                    }
                  />
                </div>
              </div>
            )}

            <div className='space-y-3'>
              <div>
                <div className='flex items-baseline justify-between gap-2'>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    豆瓣图片代理
                  </h4>
                  {getThanksInfo(doubanImageProxyType) && (
                    <button
                      type='button'
                      onClick={() =>
                        window.open(
                          getThanksInfo(doubanImageProxyType)!.url,
                          '_blank',
                        )
                      }
                      className='flex shrink-0 cursor-pointer items-center gap-1 text-[11px] leading-none text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
                    >
                      <span className='font-medium'>
                        {getThanksInfo(doubanImageProxyType)!.text}
                      </span>
                      <ExternalLink className='h-3 w-3 opacity-70' />
                    </button>
                  )}
                </div>
              </div>
              <AdminSelect
                value={doubanImageProxyType}
                onChange={(value) => handleDoubanImageProxyTypeChange(value)}
                options={doubanImageOptions}
              />
            </div>

            {doubanImageProxyType === 'custom' && (
              <div className='space-y-2'>
                <div className='flex items-center justify-between gap-3'>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    豆瓣图片代理地址
                  </h4>
                  {customProxyErrors['douban-image'] && (
                    <p className='truncate text-xs text-rose-500 dark:text-rose-400'>
                      {customProxyErrors['douban-image']}
                    </p>
                  )}
                </div>
                <div className='flex items-center gap-2'>
                  <input
                    id='local-douban-image-proxy-url'
                    name='localDoubanImageProxyUrl'
                    type='text'
                    className='min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-500 shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 dark:hover:border-gray-500'
                    placeholder='例如: https://proxy.example.com/fetch?url='
                    value={doubanImageProxyUrl}
                    onChange={(event) =>
                      handleDoubanImageProxyUrlChange(event.target.value)
                    }
                  />
                  <CustomProxyActions
                    isTesting={testingProxy === 'douban-image'}
                    onTest={() =>
                      handleTestCustomProxy('douban-image', doubanImageProxyUrl)
                    }
                  />
                </div>
              </div>
            )}

            <div className='space-y-3'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  Bangumi 数据代理
                </h4>
              </div>
              <AdminSelect
                value={bangumiDataSource}
                onChange={(value) => handleBangumiDataSourceChange(value)}
                options={bangumiOptions}
              />

              {getThanksInfo(bangumiDataSource) && (
                <div className='mt-3'>
                  <button
                    type='button'
                    onClick={() =>
                      window.open(
                        getThanksInfo(bangumiDataSource)!.url,
                        '_blank',
                      )
                    }
                    className='flex w-full cursor-pointer items-center justify-center gap-1.5 px-3 text-xs text-gray-500 dark:text-gray-400'
                  >
                    <span className='font-medium'>
                      {getThanksInfo(bangumiDataSource)!.text}
                    </span>
                    <ExternalLink className='w-3.5 opacity-70' />
                  </button>
                </div>
              )}
            </div>

            {bangumiDataSource === 'custom' && (
              <div className='space-y-2'>
                <div className='flex items-center justify-between gap-3'>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    Bangumi 代理地址
                  </h4>
                  {customProxyErrors.bangumi && (
                    <p className='truncate text-xs text-rose-500 dark:text-rose-400'>
                      {customProxyErrors.bangumi}
                    </p>
                  )}
                </div>
                <div className='flex items-center gap-2'>
                  <input
                    id='local-bangumi-proxy-url'
                    name='localBangumiProxyUrl'
                    type='text'
                    className='min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-500 shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 dark:hover:border-gray-500'
                    placeholder='例如: https://proxy.example.com/fetch?url='
                    value={bangumiProxyUrl}
                    onChange={(event) =>
                      handleBangumiProxyUrlChange(event.target.value)
                    }
                  />
                  <CustomProxyActions
                    isTesting={testingProxy === 'bangumi'}
                    onTest={() =>
                      handleTestCustomProxy('bangumi', bangumiProxyUrl)
                    }
                  />
                </div>
              </div>
            )}

            {localPreferenceToggleDefinitions.map((definition) => (
              <div
                key={definition.id}
                className='flex items-center justify-between'
              >
                <div>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    {definition.title}
                  </h4>
                  <p className={helperTextClassName}>
                    {definition.description}
                  </p>
                </div>
                <label className='flex cursor-pointer items-center'>
                  <div className='relative'>
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
                    <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
                    <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5'></div>
                  </div>
                </label>
              </div>
            ))}
          </div>
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
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
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

function resolveInitialProxySource(
  source: string,
  proxyUrl: string,
  isAuthenticated: boolean,
  storageKey: string,
): string {
  if (source === 'server' && !isAuthenticated) {
    return 'direct';
  }

  if (source === 'custom' && !normalizeCustomProxyUrl(proxyUrl)) {
    localStorage.removeItem(storageKey);
    return 'direct';
  }

  return source;
}
