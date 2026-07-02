'use client';

import { ExternalLink, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import AdminSelect from '@/features/admin/components/AdminSelect';
import AlertModal from '@/components/modals/AlertModal';
import { useAlertModal } from '@/hooks/useAlertModal';
import {
  BANGUMI_DATA_SOURCE_STORAGE_KEY,
  BANGUMI_PROXY_URL_STORAGE_KEY,
  DEFAULT_BANGUMI_DATA_SOURCE,
  bangumiDataSourceOptions,
  normalizeBangumiDataSource,
  readDefaultBangumiDataSource,
  readDefaultBangumiProxyUrl,
} from '@/lib/bangumi-source';
import {
  doubanDataSourceOptions,
  doubanImageProxyTypeOptions,
  getThanksInfo,
} from '@/lib/douban-options';
import {
  AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY,
  readBooleanLocalSetting,
  writeBooleanLocalSetting,
} from '@/lib/local-settings';

import { useBodyScrollLock } from './useBodyScrollLock';

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [defaultAggregateSearch, setDefaultAggregateSearch] = useState(true);
  const [doubanProxyUrl, setDoubanProxyUrl] = useState('');
  const [enableOptimization, setEnableOptimization] = useState(true);
  const [autoSwitchSourceOnTimeout, setAutoSwitchSourceOnTimeout] =
    useState(false);
  const [fluidSearch, setFluidSearch] = useState(true);
  const [liveDirectConnect, setLiveDirectConnect] = useState(false);
  const [doubanDataSource, setDoubanDataSource] = useState('direct');
  const [bangumiDataSource, setBangumiDataSource] = useState(
    DEFAULT_BANGUMI_DATA_SOURCE,
  );
  const [bangumiProxyUrl, setBangumiProxyUrl] = useState('');
  const [doubanImageProxyType, setDoubanImageProxyType] = useState('direct');
  const [doubanImageProxyUrl, setDoubanImageProxyUrl] = useState('');
  const { alertModal, showAlert, hideAlert } = useAlertModal();

  useBodyScrollLock(true);

  useEffect(() => {
    const savedAggregateSearch = localStorage.getItem('defaultAggregateSearch');
    if (savedAggregateSearch !== null) {
      setDefaultAggregateSearch(JSON.parse(savedAggregateSearch));
    }

    const defaultDoubanProxyType =
      window.RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE || 'direct';
    const savedDoubanDataSource = localStorage.getItem('doubanDataSource');
    if (savedDoubanDataSource !== null) {
      setDoubanDataSource(savedDoubanDataSource);
    } else if (defaultDoubanProxyType) {
      setDoubanDataSource(defaultDoubanProxyType);
    }

    const defaultDoubanProxy = window.RUNTIME_CONFIG?.DOUBAN_PROXY || '';
    const savedDoubanProxyUrl = localStorage.getItem('doubanProxyUrl');
    if (savedDoubanProxyUrl !== null) {
      setDoubanProxyUrl(savedDoubanProxyUrl);
    } else if (defaultDoubanProxy) {
      setDoubanProxyUrl(defaultDoubanProxy);
    }

    const savedBangumiDataSource = localStorage.getItem(
      BANGUMI_DATA_SOURCE_STORAGE_KEY,
    );
    if (savedBangumiDataSource !== null) {
      setBangumiDataSource(normalizeBangumiDataSource(savedBangumiDataSource));
    } else {
      setBangumiDataSource(readDefaultBangumiDataSource());
    }

    const defaultBangumiProxy = readDefaultBangumiProxyUrl();
    const savedBangumiProxyUrl = localStorage.getItem(
      BANGUMI_PROXY_URL_STORAGE_KEY,
    );
    if (savedBangumiProxyUrl !== null) {
      setBangumiProxyUrl(savedBangumiProxyUrl);
    } else if (defaultBangumiProxy) {
      setBangumiProxyUrl(defaultBangumiProxy);
    }

    const defaultDoubanImageProxyType =
      window.RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE || 'direct';
    const savedDoubanImageProxyType = localStorage.getItem(
      'doubanImageProxyType',
    );
    if (savedDoubanImageProxyType !== null) {
      setDoubanImageProxyType(savedDoubanImageProxyType);
    } else if (defaultDoubanImageProxyType) {
      setDoubanImageProxyType(defaultDoubanImageProxyType);
    }

    const defaultDoubanImageProxyUrl =
      window.RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY || '';
    const savedDoubanImageProxyUrl = localStorage.getItem(
      'doubanImageProxyUrl',
    );
    if (savedDoubanImageProxyUrl !== null) {
      setDoubanImageProxyUrl(savedDoubanImageProxyUrl);
    } else if (defaultDoubanImageProxyUrl) {
      setDoubanImageProxyUrl(defaultDoubanImageProxyUrl);
    }

    const savedEnableOptimization = localStorage.getItem('enableOptimization');
    if (savedEnableOptimization !== null) {
      setEnableOptimization(JSON.parse(savedEnableOptimization));
    }

    setAutoSwitchSourceOnTimeout(
      readBooleanLocalSetting(AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY, false),
    );

    const savedFluidSearch = localStorage.getItem('fluidSearch');
    const defaultFluidSearch = window.RUNTIME_CONFIG?.FLUID_SEARCH !== false;
    if (savedFluidSearch !== null) {
      setFluidSearch(JSON.parse(savedFluidSearch));
    } else {
      setFluidSearch(defaultFluidSearch);
    }

    const savedLiveDirectConnect = localStorage.getItem('liveDirectConnect');
    if (savedLiveDirectConnect !== null) {
      setLiveDirectConnect(JSON.parse(savedLiveDirectConnect));
    }
  }, []);

  const showProxyToast = () => {
    showAlert({
      type: 'success',
      title: '更换成功',
      message: '刷新页面后生效',
      timer: 2000,
    });
  };

  const handleAggregateToggle = (value: boolean) => {
    setDefaultAggregateSearch(value);
    localStorage.setItem('defaultAggregateSearch', JSON.stringify(value));
  };

  const handleDoubanProxyUrlChange = (value: string) => {
    setDoubanProxyUrl(value);
    localStorage.setItem('doubanProxyUrl', value);
  };

  const handleOptimizationToggle = (value: boolean) => {
    setEnableOptimization(value);
    localStorage.setItem('enableOptimization', JSON.stringify(value));
  };

  const handleAutoSwitchSourceOnTimeoutToggle = (value: boolean) => {
    setAutoSwitchSourceOnTimeout(value);
    writeBooleanLocalSetting(AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY, value);
  };

  const handleFluidSearchToggle = (value: boolean) => {
    setFluidSearch(value);
    localStorage.setItem('fluidSearch', JSON.stringify(value));
  };

  const handleLiveDirectConnectToggle = (value: boolean) => {
    setLiveDirectConnect(value);
    localStorage.setItem('liveDirectConnect', JSON.stringify(value));
  };

  const handleDoubanDataSourceChange = (value: string) => {
    setDoubanDataSource(value);
    localStorage.setItem('doubanDataSource', value);
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
    localStorage.setItem('doubanImageProxyType', value);
    showProxyToast();
  };

  const handleDoubanImageProxyUrlChange = (value: string) => {
    setDoubanImageProxyUrl(value);
    localStorage.setItem('doubanImageProxyUrl', value);
  };

  const handleResetSettings = () => {
    const defaultDoubanProxyType =
      window.RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE || 'direct';
    const defaultDoubanProxy = window.RUNTIME_CONFIG?.DOUBAN_PROXY || '';
    const defaultDoubanImageProxyType =
      window.RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE || 'direct';
    const defaultDoubanImageProxyUrl =
      window.RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY || '';
    const defaultBangumiDataSource = readDefaultBangumiDataSource();
    const defaultBangumiProxy = readDefaultBangumiProxyUrl();
    const defaultFluidSearch = window.RUNTIME_CONFIG?.FLUID_SEARCH !== false;

    setDefaultAggregateSearch(true);
    setEnableOptimization(true);
    setAutoSwitchSourceOnTimeout(false);
    setFluidSearch(defaultFluidSearch);
    setLiveDirectConnect(false);
    setDoubanProxyUrl(defaultDoubanProxy);
    setDoubanDataSource(defaultDoubanProxyType);
    setBangumiDataSource(defaultBangumiDataSource);
    setBangumiProxyUrl(defaultBangumiProxy);
    setDoubanImageProxyType(defaultDoubanImageProxyType);
    setDoubanImageProxyUrl(defaultDoubanImageProxyUrl);

    localStorage.setItem('defaultAggregateSearch', JSON.stringify(true));
    localStorage.setItem('enableOptimization', JSON.stringify(true));
    writeBooleanLocalSetting(AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY, false);
    localStorage.removeItem('fluidSearch');
    localStorage.setItem('liveDirectConnect', JSON.stringify(false));
    localStorage.setItem('doubanProxyUrl', defaultDoubanProxy);
    localStorage.setItem('doubanDataSource', defaultDoubanProxyType);
    localStorage.setItem(
      BANGUMI_DATA_SOURCE_STORAGE_KEY,
      defaultBangumiDataSource,
    );
    localStorage.setItem(BANGUMI_PROXY_URL_STORAGE_KEY, defaultBangumiProxy);
    localStorage.setItem('doubanImageProxyType', defaultDoubanImageProxyType);
    localStorage.setItem('doubanImageProxyUrl', defaultDoubanImageProxyUrl);
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
            <div className='flex items-center gap-3'>
              <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                本地设置
              </h3>
              <button
                onClick={handleResetSettings}
                className='rounded border border-red-200 px-2 py-1 text-xs text-red-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:border-red-700 dark:hover:bg-red-900/20 dark:hover:text-red-300'
                title='重置为默认设置'
              >
                恢复默认
              </button>
            </div>
            <button
              onClick={onClose}
              className='flex h-8 w-8 items-center justify-center rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800'
              aria-label='Close'
            >
              <X className='h-full w-full' />
            </button>
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
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  选择获取豆瓣数据的方式
                </p>
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
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                    自定义代理服务器地址
                  </p>
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
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  选择获取豆瓣图片的方式
                </p>
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
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
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
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  选择获取新番放送数据的方式
                </p>
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
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                    自定义代理服务器地址
                  </p>
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

            <div className='border-t border-gray-200 dark:border-gray-700'></div>

            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  默认聚合搜索结果
                </h4>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  搜索时默认按标题和年份聚合显示结果
                </p>
              </div>
              <label className='flex cursor-pointer items-center'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='peer sr-only'
                    checked={defaultAggregateSearch}
                    onChange={(event) =>
                      handleAggregateToggle(event.target.checked)
                    }
                  />
                  <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
                  <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  优选和测速
                </h4>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  如出现播放器劫持问题可关闭
                </p>
              </div>
              <label className='flex cursor-pointer items-center'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='peer sr-only'
                    checked={enableOptimization}
                    onChange={(event) =>
                      handleOptimizationToggle(event.target.checked)
                    }
                  />
                  <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
                  <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  源站超时自动换源(实验性)
                </h4>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  播放源加载超时后，自动切换到下一个候选源
                </p>
              </div>
              <label className='flex cursor-pointer items-center'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='peer sr-only'
                    checked={autoSwitchSourceOnTimeout}
                    onChange={(event) =>
                      handleAutoSwitchSourceOnTimeoutToggle(
                        event.target.checked,
                      )
                    }
                  />
                  <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
                  <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  流式搜索输出
                </h4>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  启用搜索结果实时流式输出，关闭后使用传统一次性搜索
                </p>
              </div>
              <label className='flex cursor-pointer items-center'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='peer sr-only'
                    checked={fluidSearch}
                    onChange={(event) =>
                      handleFluidSearchToggle(event.target.checked)
                    }
                  />
                  <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
                  <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  IPTV 视频浏览器直连
                </h4>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  开启 IPTV 视频浏览器直连时，需要自备 Allow CORS 插件
                </p>
              </div>
              <label className='flex cursor-pointer items-center'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='peer sr-only'
                    checked={liveDirectConnect}
                    onChange={(event) =>
                      handleLiveDirectConnectToggle(event.target.checked)
                    }
                  />
                  <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
                  <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>
          </div>

          <div className='mt-6 border-t border-gray-200 pt-4 dark:border-gray-700'>
            <p className='text-center text-xs text-gray-500 dark:text-gray-400'>
              这些设置保存在本地浏览器中
            </p>
          </div>
        </div>
      </div>
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
