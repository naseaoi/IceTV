'use client';

import { ExternalLink, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import AdminSelect from '@/components/admin/AdminSelect';
import AlertModal from '@/components/modals/AlertModal';
import ConfirmModal from '@/components/modals/ConfirmModal';
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

import { useBodyScrollLock } from './useBodyScrollLock';

interface SettingsPanelProps {
  onClose: () => void;
}

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
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const { alertModal, showAlert, hideAlert } = useAlertModal();

  useBodyScrollLock(true);

  useEffect(() => {
    setLocalPreferenceToggles(readLocalPreferenceToggleState());

    setDoubanDataSource(readDoubanProxyType());
    setDoubanProxyUrl(readDoubanProxyUrl());
    setBangumiDataSource(readBangumiDataSource());
    setBangumiProxyUrl(readBangumiProxyUrl());

    setDoubanImageProxyType(readDoubanImageProxyType());
    setDoubanImageProxyUrl(readDoubanImageProxyUrl());
  }, []);

  const showProxyToast = () => {
    showAlert({
      type: 'success',
      title: '更换成功',
      message: '刷新页面后生效',
      timer: 2000,
    });
  };

  const handleDoubanProxyUrlChange = (value: string) => {
    setDoubanProxyUrl(value);
    localStorage.setItem(DOUBAN_PROXY_URL_STORAGE_KEY, value);
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
    setDoubanDataSource(value);
    localStorage.setItem(DOUBAN_DATA_SOURCE_STORAGE_KEY, value);
    showProxyToast();
  };

  const handleBangumiDataSourceChange = (value: string) => {
    const nextSource = normalizeBangumiDataSource(value);
    setBangumiDataSource(nextSource);
    localStorage.setItem(BANGUMI_DATA_SOURCE_STORAGE_KEY, nextSource);
    showProxyToast();
  };

  const handleBangumiProxyUrlChange = (value: string) => {
    setBangumiProxyUrl(value);
    localStorage.setItem(BANGUMI_PROXY_URL_STORAGE_KEY, value);
  };

  const handleDoubanImageProxyTypeChange = (value: string) => {
    setDoubanImageProxyType(value);
    localStorage.setItem(DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY, value);
    showProxyToast();
  };

  const handleDoubanImageProxyUrlChange = (value: string) => {
    setDoubanImageProxyUrl(value);
    localStorage.setItem(DOUBAN_IMAGE_PROXY_URL_STORAGE_KEY, value);
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
                options={doubanDataSourceOptions}
              />
            </div>

            {doubanDataSource === 'custom' && (
              <div className='space-y-3'>
                <div>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    豆瓣代理地址
                  </h4>
                  <p className={helperTextClassName}>自定义代理服务器地址</p>
                </div>
                <input
                  type='text'
                  className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-500 shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 dark:hover:border-gray-500'
                  placeholder='例如: https://proxy.example.com/fetch?url='
                  value={doubanProxyUrl}
                  onChange={(event) =>
                    handleDoubanProxyUrlChange(event.target.value)
                  }
                />
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
                options={doubanImageProxyTypeOptions}
              />
            </div>

            {doubanImageProxyType === 'custom' && (
              <div className='space-y-3'>
                <div>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    豆瓣图片代理地址
                  </h4>
                  <p className={helperTextClassName}>
                    自定义图片代理服务器地址
                  </p>
                </div>
                <input
                  type='text'
                  className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-500 shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 dark:hover:border-gray-500'
                  placeholder='例如: https://proxy.example.com/fetch?url='
                  value={doubanImageProxyUrl}
                  onChange={(event) =>
                    handleDoubanImageProxyUrlChange(event.target.value)
                  }
                />
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
                options={bangumiDataSourceOptions}
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
              <div className='space-y-3'>
                <div>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    Bangumi 代理地址
                  </h4>
                  <p className={helperTextClassName}>自定义代理服务器地址</p>
                </div>
                <input
                  type='text'
                  className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-500 shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 dark:hover:border-gray-500'
                  placeholder='例如: https://proxy.example.com/fetch?url='
                  value={bangumiProxyUrl}
                  onChange={(event) =>
                    handleBangumiProxyUrlChange(event.target.value)
                  }
                />
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
