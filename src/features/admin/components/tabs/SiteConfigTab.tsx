'use client';

import { ExternalLink, ImagePlus, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import AdminSelect from '@/components/admin/AdminSelect';
import AlertModal from '@/components/modals/AlertModal';
import { useAlertModal } from '@/hooks/useAlertModal';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { adminPost } from '@/features/admin/lib/api';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { showError, showSuccess } from '@/features/admin/lib/notifications';
import { AdminConfig } from '@/types/admin';
import { SiteConfig } from '@/features/admin/types/internal';
import {
  DEFAULT_BANGUMI_DATA_SOURCE,
  bangumiDataSourceOptions,
  normalizeBangumiDataSource,
} from '@/lib/bangumi-source';
import {
  doubanDataSourceOptions,
  doubanImageProxyTypeOptions,
  getThanksInfo,
} from '@/lib/douban-options';
import { DEFAULT_DOUBAN_IMAGE_PROXY_TYPE } from '@/lib/douban-source';
import { localPreferenceToggleDefinitions } from '@/lib/local-preference-toggles';

const SiteConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [siteSettings, setSiteSettings] = useState<SiteConfig>({
    SiteName: '',
    SiteIcon: '',
    Announcement: '',
    EnableLiveEntry: false,
    DefaultAggregateSearch: true,
    EnableOptimization: true,
    AutoSwitchSourceOnTimeout: false,
    LiveDirectConnect: false,
    SearchDownstreamMaxPage: 1,
    SiteInterfaceCacheTime: 7200,
    DoubanProxyType: 'direct',
    DoubanProxy: '',
    BangumiDataSource: DEFAULT_BANGUMI_DATA_SOURCE,
    BangumiProxy: '',
    DoubanImageProxyType: DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
    DoubanImageProxy: '',
    DisableYellowFilter: false,
    FluidSearch: true,
  });

  // 站点图标相关状态
  const [iconPreview, setIconPreview] = useState<string>('');
  const [iconUploading, setIconUploading] = useState(false);
  const iconFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (config?.SiteConfig) {
      setSiteSettings({
        ...config.SiteConfig,
        DoubanProxyType: config.SiteConfig.DoubanProxyType || 'direct',
        DoubanProxy: config.SiteConfig.DoubanProxy || '',
        BangumiDataSource: normalizeBangumiDataSource(
          config.SiteConfig.BangumiDataSource,
        ),
        BangumiProxy: config.SiteConfig.BangumiProxy || '',
        DoubanImageProxyType:
          config.SiteConfig.DoubanImageProxyType ||
          DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
        DoubanImageProxy: config.SiteConfig.DoubanImageProxy || '',
        EnableLiveEntry: config.SiteConfig.EnableLiveEntry ?? false,
        DefaultAggregateSearch:
          config.SiteConfig.DefaultAggregateSearch ?? true,
        EnableOptimization: config.SiteConfig.EnableOptimization ?? true,
        AutoSwitchSourceOnTimeout:
          config.SiteConfig.AutoSwitchSourceOnTimeout ?? false,
        LiveDirectConnect: config.SiteConfig.LiveDirectConnect ?? false,
        DisableYellowFilter: config.SiteConfig.DisableYellowFilter ?? false,
        FluidSearch: config.SiteConfig.FluidSearch ?? true,
      });
      // 初始化图标预览
      const icon = config.SiteConfig.SiteIcon;
      if (icon) {
        setIconPreview(icon.startsWith('/') ? `${icon}?t=${Date.now()}` : icon);
      }
    }
  }, [config]);

  // 处理豆瓣数据源变化
  const handleDoubanDataSourceChange = (value: string) => {
    setSiteSettings((prev) => ({
      ...prev,
      DoubanProxyType: value,
    }));
  };

  const handleBangumiDataSourceChange = (value: string) => {
    setSiteSettings((prev) => ({
      ...prev,
      BangumiDataSource: normalizeBangumiDataSource(value),
    }));
  };

  // 处理豆瓣图片代理变化
  const handleDoubanImageProxyChange = (value: string) => {
    setSiteSettings((prev) => ({
      ...prev,
      DoubanImageProxyType: value,
    }));
  };

  const handleLocalPreferenceDefaultToggle = (
    siteConfigKey:
      | 'DefaultAggregateSearch'
      | 'EnableOptimization'
      | 'AutoSwitchSourceOnTimeout'
      | 'FluidSearch'
      | 'LiveDirectConnect',
  ) => {
    setSiteSettings(
      (prev) =>
        ({
          ...prev,
          [siteConfigKey]: !prev[siteConfigKey],
        }) as SiteConfig,
    );
  };

  // 保存站点配置
  const handleSave = async () => {
    await withLoading('saveSiteConfig', async () => {
      try {
        await adminPost('/api/admin/site', { ...siteSettings }, '保存失败');

        showSuccess('保存成功, 请刷新页面', showAlert);
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
    <div className='space-y-6'>
      <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
        {/* 站点名称 */}
        <div>
          <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
            站点名称
          </label>
          <input
            type='text'
            value={siteSettings.SiteName}
            onChange={(e) =>
              setSiteSettings((prev) => ({ ...prev, SiteName: e.target.value }))
            }
            className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          />
        </div>

        {/* 站点图标 */}
        <div>
          <div className='mb-2 flex items-end gap-2'>
            <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
              站点图标
            </label>
            <p className='text-xs text-gray-400 dark:text-gray-500'>
              PNG/JPEG/WebP/SVG/ICO，≤512KB
            </p>
          </div>
          <div className='flex items-start gap-3'>
            {/* 预览 */}
            <div className='flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-800'>
              {iconPreview ? (
                <img
                  src={iconPreview}
                  alt='站点图标'
                  className='h-full w-full object-contain'
                  onError={() => setIconPreview('')}
                />
              ) : (
                <ImagePlus className='h-5 w-5 text-gray-400' />
              )}
            </div>
            <div className='min-w-0 flex-1 space-y-2'>
              <div className='flex min-w-0 items-center gap-2'>
                <input
                  type='text'
                  value={siteSettings.SiteIcon}
                  onChange={(e) => {
                    const url = e.target.value;
                    setSiteSettings((prev) => ({ ...prev, SiteIcon: url }));
                    setIconPreview(url);
                  }}
                  placeholder='输入图标 URL 或上传文件'
                  className='min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                />
                <div className='flex shrink-0 items-center gap-2'>
                  <button
                    type='button'
                    disabled={iconUploading}
                    onClick={() => iconFileRef.current?.click()}
                    aria-label={iconUploading ? '上传中' : '上传图标'}
                    title={iconUploading ? '上传中...' : '上传图标'}
                    className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  >
                    <Upload className='h-5 w-5' />
                  </button>
                  {siteSettings.SiteIcon && (
                    <button
                      type='button'
                      onClick={async () => {
                        if (
                          siteSettings.SiteIcon.startsWith(
                            '/api/admin/site-icon',
                          )
                        ) {
                          try {
                            await fetch('/api/admin/site-icon', {
                              method: 'DELETE',
                            });
                          } catch {
                            /* ignore */
                          }
                        }
                        setSiteSettings((prev) => ({ ...prev, SiteIcon: '' }));
                        setIconPreview('');
                      }}
                      className='flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-600/50 dark:text-red-400 dark:hover:bg-red-900/20'
                    >
                      <Trash2 className='h-3.5 w-3.5' />
                      清除
                    </button>
                  )}
                </div>
              </div>
              <input
                ref={iconFileRef}
                type='file'
                accept='image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/x-icon'
                className='hidden'
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 512 * 1024) {
                    showError('图标文件不能超过 512KB', showAlert);
                    return;
                  }
                  setIconUploading(true);
                  try {
                    const formData = new FormData();
                    formData.append('icon', file);
                    const res = await fetch('/api/admin/site-icon', {
                      method: 'POST',
                      body: formData,
                    });
                    const data = await res.json();
                    if (!res.ok) {
                      showError(data.error || '上传失败', showAlert);
                      return;
                    }
                    setSiteSettings((prev) => ({
                      ...prev,
                      SiteIcon: '/api/admin/site-icon',
                    }));
                    setIconPreview(
                      data.url || `/api/admin/site-icon?t=${Date.now()}`,
                    );
                    showSuccess('图标上传成功', showAlert);
                  } catch (err) {
                    showError('上传失败', showAlert);
                  } finally {
                    setIconUploading(false);
                    e.target.value = '';
                  }
                }}
              />
            </div>
          </div>
        </div>

        {/* 站点公告 */}
        <div>
          <div className='mb-2 flex items-end gap-2'>
            <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
              站点公告
            </label>
            <p className='text-xs text-gray-400 dark:text-gray-500'>
              修改后将会重新推送给用户
            </p>
          </div>
          <textarea
            value={siteSettings.Announcement}
            onChange={(e) =>
              setSiteSettings((prev) => ({
                ...prev,
                Announcement: e.target.value,
              }))
            }
            rows={1}
            className='w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          />
        </div>

        {/* 豆瓣数据源设置 */}
        <div className='space-y-3'>
          <div>
            <div className='mb-2 flex items-baseline justify-between gap-2'>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
                豆瓣数据代理
              </label>
              {getThanksInfo(siteSettings.DoubanProxyType) && (
                <button
                  type='button'
                  onClick={() =>
                    window.open(
                      getThanksInfo(siteSettings.DoubanProxyType)!.url,
                      '_blank',
                    )
                  }
                  className='flex shrink-0 cursor-pointer items-center gap-1 text-[11px] leading-none text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
                >
                  <span className='font-medium'>
                    {getThanksInfo(siteSettings.DoubanProxyType)!.text}
                  </span>
                  <ExternalLink className='h-3 w-3 opacity-70' />
                </button>
              )}
            </div>
            <AdminSelect
              value={siteSettings.DoubanProxyType}
              onChange={(value) => handleDoubanDataSourceChange(value)}
              options={doubanDataSourceOptions}
            />
          </div>

          {siteSettings.DoubanProxyType === 'custom' && (
            <div>
              <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
                豆瓣代理地址
              </label>
              <input
                type='text'
                placeholder='例如: https://proxy.example.com/fetch?url='
                value={siteSettings.DoubanProxy}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    DoubanProxy: e.target.value,
                  }))
                }
                className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-500 shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 dark:hover:border-gray-500'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                自定义代理服务器地址
              </p>
            </div>
          )}
        </div>

        {/* 豆瓣图片代理设置 */}
        <div className='space-y-3'>
          <div>
            <div className='mb-2 flex items-baseline justify-between gap-2'>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
                豆瓣图片代理
              </label>
              {getThanksInfo(siteSettings.DoubanImageProxyType) && (
                <button
                  type='button'
                  onClick={() =>
                    window.open(
                      getThanksInfo(siteSettings.DoubanImageProxyType)!.url,
                      '_blank',
                    )
                  }
                  className='flex shrink-0 cursor-pointer items-center gap-1 text-[11px] leading-none text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
                >
                  <span className='font-medium'>
                    {getThanksInfo(siteSettings.DoubanImageProxyType)!.text}
                  </span>
                  <ExternalLink className='h-3 w-3 opacity-70' />
                </button>
              )}
            </div>
            <AdminSelect
              value={siteSettings.DoubanImageProxyType}
              onChange={(value) => handleDoubanImageProxyChange(value)}
              options={doubanImageProxyTypeOptions}
            />
          </div>

          {siteSettings.DoubanImageProxyType === 'custom' && (
            <div>
              <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
                豆瓣图片代理地址
              </label>
              <input
                type='text'
                placeholder='例如: https://proxy.example.com/fetch?url='
                value={siteSettings.DoubanImageProxy}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    DoubanImageProxy: e.target.value,
                  }))
                }
                className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-500 shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 dark:hover:border-gray-500'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                自定义图片代理服务器地址
              </p>
            </div>
          )}
        </div>

        <div className='space-y-3'>
          <div>
            <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
              Bangumi 数据代理
            </label>
            <AdminSelect
              value={siteSettings.BangumiDataSource}
              onChange={(value) => handleBangumiDataSourceChange(value)}
              options={bangumiDataSourceOptions}
            />
          </div>

          {siteSettings.BangumiDataSource === 'custom' && (
            <div>
              <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
                Bangumi 代理地址
              </label>
              <input
                type='text'
                placeholder='例如: https://proxy.example.com/fetch?url='
                value={siteSettings.BangumiProxy}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    BangumiProxy: e.target.value,
                  }))
                }
                className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-500 shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 dark:hover:border-gray-500'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                自定义代理服务器地址
              </p>
            </div>
          )}
        </div>

        {/* 搜索接口可拉取最大页数 */}
        <div>
          <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
            搜索接口可拉取最大页数
          </label>
          <input
            type='number'
            min={1}
            value={siteSettings.SearchDownstreamMaxPage}
            onChange={(e) =>
              setSiteSettings((prev) => ({
                ...prev,
                SearchDownstreamMaxPage: Number(e.target.value),
              }))
            }
            className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          />
        </div>

        {/* 站点接口缓存时间 */}
        <div>
          <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
            站点接口缓存时间（秒）
          </label>
          <input
            type='number'
            min={1}
            value={siteSettings.SiteInterfaceCacheTime}
            onChange={(e) =>
              setSiteSettings((prev) => ({
                ...prev,
                SiteInterfaceCacheTime: Number(e.target.value),
              }))
            }
            className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          />
        </div>
      </div>

      <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
        <div className='flex min-h-[96px] items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/55'>
          <div>
            <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
              显示直播入口
            </p>
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              开启后，侧栏和底部导航会显示“直播”分类入口。
            </p>
          </div>
          <button
            type='button'
            onClick={() =>
              setSiteSettings((prev) => ({
                ...prev,
                EnableLiveEntry: !prev.EnableLiveEntry,
              }))
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              siteSettings.EnableLiveEntry
                ? 'bg-green-500'
                : 'bg-gray-300 dark:bg-gray-600'
            }`}
            aria-label='切换直播入口显示'
            aria-pressed={siteSettings.EnableLiveEntry}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                siteSettings.EnableLiveEntry
                  ? 'translate-x-5'
                  : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        <div className='flex min-h-[96px] items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/55'>
          <div>
            <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
              NSFW模式
            </p>
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              开启后，允许NSFW内容。
            </p>
          </div>
          <button
            type='button'
            onClick={() =>
              setSiteSettings((prev) => ({
                ...prev,
                DisableYellowFilter: !prev.DisableYellowFilter,
              }))
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              siteSettings.DisableYellowFilter
                ? 'bg-green-500'
                : 'bg-gray-300 dark:bg-gray-600'
            }`}
            aria-label='切换NSFW模式'
            aria-pressed={siteSettings.DisableYellowFilter}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                siteSettings.DisableYellowFilter
                  ? 'translate-x-5'
                  : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      <div className='space-y-3'>
        <div>
          <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
            本地设置默认值
          </h3>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            这里的设置会作为用户“本地设置”的默认值。
          </p>
        </div>

        <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
          {localPreferenceToggleDefinitions.map((definition) => {
            const enabled = siteSettings[definition.siteConfigKey];

            return (
              <div
                key={definition.id}
                className='flex min-h-[96px] items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/55'
              >
                <div>
                  <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                    {definition.title}
                  </p>
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                    {definition.description}
                  </p>
                </div>
                <button
                  type='button'
                  onClick={() =>
                    handleLocalPreferenceDefaultToggle(definition.siteConfigKey)
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                  aria-label={`切换${definition.title}`}
                  aria-pressed={enabled}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                      enabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className='flex justify-end'>
        <button
          onClick={handleSave}
          disabled={isLoading('saveSiteConfig')}
          className={`px-4 py-2 ${
            isLoading('saveSiteConfig')
              ? buttonStyles.disabled
              : buttonStyles.success
          } rounded-lg transition-colors`}
        >
          {isLoading('saveSiteConfig') ? '保存中…' : '保存'}
        </button>
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

export default SiteConfigComponent;
