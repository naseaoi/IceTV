'use client';

import { ExternalLink, ImagePlus, Trash2, Upload } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import AdminSelect from '@/components/admin/AdminSelect';
import AlertModal from '@/components/modals/AlertModal';
import { useAlertModal } from '@/hooks/useAlertModal';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { adminPost } from '@/features/admin/lib/api';
import { SITE_CONFIG_FORM_ID } from '@/features/admin/lib/admin-form-ids';
import { showError, showSuccess } from '@/features/admin/lib/notifications';
import { AdminConfig } from '@/types/admin';
import { SiteConfig } from '@/features/admin/types/internal';
import {
  DEFAULT_BANGUMI_DATA_SOURCE,
  normalizeSiteBangumiDataSource,
  siteBangumiDataSourceOptions,
} from '@/lib/bangumi-source';
import {
  getThanksInfo,
  normalizeSiteDoubanImageProxyType,
  normalizeSiteDoubanProxyType,
  siteDoubanDataSourceOptions,
  siteDoubanImageProxyTypeOptions,
} from '@/lib/douban-options';
import { DEFAULT_DOUBAN_IMAGE_PROXY_TYPE } from '@/lib/douban-source';
import { localPreferenceToggleDefinitions } from '@/lib/local-preference-toggles';
import { DEFAULT_RUNTIME_PARAMS } from '@/lib/runtime-params';

const DEFAULT_SITE_SETTINGS: SiteConfig = {
  SiteName: '',
  SiteIcon: '',
  Announcement: '',
  EnableLiveEntry: false,
  DefaultAggregateSearch: true,
  EnableOptimization: true,
  AutoSwitchSourceOnTimeout: false,
  LiveDirectConnect: false,
  ...DEFAULT_RUNTIME_PARAMS,
  DoubanProxyType: 'direct',
  DoubanProxy: '',
  BangumiDataSource: DEFAULT_BANGUMI_DATA_SOURCE,
  BangumiProxy: '',
  DoubanImageProxyType: DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
  DoubanImageProxy: '',
  DisableYellowFilter: false,
  FluidSearch: true,
};

type EditableSiteSettings = Pick<
  SiteConfig,
  | 'SiteName'
  | 'SiteIcon'
  | 'Announcement'
  | 'EnableLiveEntry'
  | 'DefaultAggregateSearch'
  | 'EnableOptimization'
  | 'AutoSwitchSourceOnTimeout'
  | 'LiveDirectConnect'
  | 'DoubanProxyType'
  | 'BangumiDataSource'
  | 'DoubanImageProxyType'
  | 'DisableYellowFilter'
  | 'FluidSearch'
>;

function buildSiteSettings(config: AdminConfig): SiteConfig {
  return {
    ...config.SiteConfig,
    DoubanProxyType: normalizeSiteDoubanProxyType(
      config.SiteConfig.DoubanProxyType,
    ),
    DoubanProxy: '',
    BangumiDataSource: normalizeSiteBangumiDataSource(
      config.SiteConfig.BangumiDataSource,
    ),
    BangumiProxy: '',
    DoubanImageProxyType: normalizeSiteDoubanImageProxyType(
      config.SiteConfig.DoubanImageProxyType,
    ),
    DoubanImageProxy: '',
    EnableLiveEntry: config.SiteConfig.EnableLiveEntry ?? false,
    DefaultAggregateSearch: config.SiteConfig.DefaultAggregateSearch ?? true,
    EnableOptimization: config.SiteConfig.EnableOptimization ?? true,
    AutoSwitchSourceOnTimeout:
      config.SiteConfig.AutoSwitchSourceOnTimeout ?? false,
    LiveDirectConnect: config.SiteConfig.LiveDirectConnect ?? false,
    DisableYellowFilter: config.SiteConfig.DisableYellowFilter ?? false,
    FluidSearch: config.SiteConfig.FluidSearch ?? true,
  };
}

function normalizeEditableSiteSettings(
  value: SiteConfig,
): EditableSiteSettings {
  return {
    SiteName: value.SiteName || '',
    SiteIcon: value.SiteIcon || '',
    Announcement: value.Announcement || '',
    EnableLiveEntry: value.EnableLiveEntry ?? false,
    DefaultAggregateSearch: value.DefaultAggregateSearch ?? true,
    EnableOptimization: value.EnableOptimization ?? true,
    AutoSwitchSourceOnTimeout: value.AutoSwitchSourceOnTimeout ?? false,
    LiveDirectConnect: value.LiveDirectConnect ?? false,
    DoubanProxyType: normalizeSiteDoubanProxyType(value.DoubanProxyType),
    BangumiDataSource: normalizeSiteBangumiDataSource(value.BangumiDataSource),
    DoubanImageProxyType: normalizeSiteDoubanImageProxyType(
      value.DoubanImageProxyType,
    ),
    DisableYellowFilter: value.DisableYellowFilter ?? false,
    FluidSearch: value.FluidSearch ?? true,
  };
}

const SiteConfigComponent = ({
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
  const { withLoading } = useLoadingState();
  const [siteSettings, setSiteSettings] = useState<SiteConfig>(
    DEFAULT_SITE_SETTINGS,
  );
  const [baselineSiteSettings, setBaselineSiteSettings] =
    useState<EditableSiteSettings>(() =>
      normalizeEditableSiteSettings(DEFAULT_SITE_SETTINGS),
    );

  // 站点图标相关状态
  const [iconPreview, setIconPreview] = useState<string>('');
  const [iconUploading, setIconUploading] = useState(false);
  const iconFileRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const normalizedSiteSettings = normalizeEditableSiteSettings(siteSettings);
  const siteSettingsDirty =
    JSON.stringify(normalizedSiteSettings) !==
    JSON.stringify(baselineSiteSettings);

  useEffect(() => {
    if (config?.SiteConfig) {
      const nextSiteSettings = buildSiteSettings(config);
      setSiteSettings(nextSiteSettings);
      setBaselineSiteSettings(normalizeEditableSiteSettings(nextSiteSettings));
      // 初始化图标预览
      const icon = config.SiteConfig.SiteIcon;
      if (icon) {
        setIconPreview(icon.startsWith('/') ? `${icon}?t=${Date.now()}` : icon);
      }
    }
  }, [config]);

  useEffect(() => {
    onDirtyChange?.(siteSettingsDirty);
  }, [onDirtyChange, siteSettingsDirty]);

  // 处理豆瓣数据源变化
  const handleDoubanDataSourceChange = (value: string) => {
    setSiteSettings((prev) => ({
      ...prev,
      DoubanProxyType: value,
      DoubanProxy: '',
    }));
  };

  const handleBangumiDataSourceChange = (value: string) => {
    const nextSource = normalizeSiteBangumiDataSource(value);
    setSiteSettings((prev) => ({
      ...prev,
      BangumiDataSource: nextSource,
      BangumiProxy: '',
    }));
  };

  // 处理豆瓣图片代理变化
  const handleDoubanImageProxyChange = (value: string) => {
    setSiteSettings((prev) => ({
      ...prev,
      DoubanImageProxyType: value,
      DoubanImageProxy: '',
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

  const handleSave = async () => {
    if (savingRef.current || !siteSettingsDirty) {
      return;
    }

    savingRef.current = true;
    onSavingChange?.(true);

    try {
      await withLoading('saveSiteConfig', async () => {
        await adminPost('/api/admin/site', { ...siteSettings }, '保存失败');

        setBaselineSiteSettings(normalizedSiteSettings);
        showSuccess('保存成功, 请刷新页面', showAlert);
        await refreshConfig();
      });
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败', showAlert);
    } finally {
      savingRef.current = false;
      onSavingChange?.(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSave();
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <form
      id={SITE_CONFIG_FORM_ID}
      onSubmit={handleSubmit}
      className='space-y-6'
    >
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
              options={siteDoubanDataSourceOptions}
            />
          </div>
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
              options={siteDoubanImageProxyTypeOptions}
            />
          </div>
        </div>

        <div className='space-y-3'>
          <div>
            <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
              Bangumi 数据代理
            </label>
            <AdminSelect
              value={siteSettings.BangumiDataSource}
              onChange={(value) => handleBangumiDataSourceChange(value)}
              options={siteBangumiDataSourceOptions}
            />
          </div>
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
    </form>
  );
};

export default SiteConfigComponent;
