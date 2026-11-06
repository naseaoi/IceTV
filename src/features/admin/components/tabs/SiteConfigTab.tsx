'use client';

import {
  CheckCircle2,
  ExternalLink,
  ImagePlus,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import AdminSelect from '@/components/admin/AdminSelect';
import AlertModal from '@/components/modals/AlertModal';
import Spinner from '@/components/Spinner';
import {
  AdminSettingRow,
  AdminSettingsGroup,
} from '@/features/admin/components/AdminSettings';
import { AdminStatusSwitch } from '@/features/admin/components/AdminStatusSwitch';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { SITE_CONFIG_FORM_ID } from '@/features/admin/lib/admin-form-ids';
import { adminPost } from '@/features/admin/lib/api';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { showError, showSuccess } from '@/features/admin/lib/notifications';
import { SiteConfig } from '@/features/admin/types/internal';
import { useAlertModal } from '@/hooks/useAlertModal';
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
import {
  type LocalPreferenceToggleSiteConfigKey,
  localPreferenceToggleDefinitions,
} from '@/lib/local-preference-toggles';
import { DEFAULT_RUNTIME_PARAMS } from '@/lib/runtime-params';
import { DEFAULT_SITE_FOOTER_TEXT } from '@/lib/site-footer';
import {
  DEFAULT_SOURCE_COVER_PROXY_MODE,
  normalizeSourceCoverProxyMode,
  sourceCoverProxyModeOptions,
} from '@/lib/source-cover-proxy';
import { AdminConfig } from '@/types/admin';

const DEFAULT_SITE_SETTINGS: SiteConfig = {
  SiteName: '',
  SiteIcon: '',
  Announcement: '',
  FooterText: DEFAULT_SITE_FOOTER_TEXT,
  EnableLiveEntry: false,
  DefaultAggregateSearch: true,
  EnableOptimization: true,
  LiveDirectConnect: false,
  AutoSwitchSource: false,
  EnableDanmaku: false,
  EnableUserDanmaku: false,
  ...DEFAULT_RUNTIME_PARAMS,
  DoubanProxyType: 'direct',
  BangumiDataSource: DEFAULT_BANGUMI_DATA_SOURCE,
  DoubanImageProxyType: DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
  SourceCoverProxyMode: DEFAULT_SOURCE_COVER_PROXY_MODE,
  DisableYellowFilter: false,
  FluidSearch: true,
};

type EditableSiteSettings = Pick<
  SiteConfig,
  | 'SiteName'
  | 'SiteIcon'
  | 'Announcement'
  | 'FooterText'
  | 'EnableLiveEntry'
  | 'DefaultAggregateSearch'
  | 'EnableOptimization'
  | 'LiveDirectConnect'
  | 'AutoSwitchSource'
  | 'EnableDanmaku'
  | 'EnableUserDanmaku'
  | 'DoubanProxyType'
  | 'BangumiDataSource'
  | 'DoubanImageProxyType'
  | 'SourceCoverProxyMode'
  | 'DisableYellowFilter'
  | 'FluidSearch'
>;

function buildSiteSettings(config: AdminConfig): SiteConfig {
  return {
    ...config.SiteConfig,
    DoubanProxyType: normalizeSiteDoubanProxyType(
      config.SiteConfig.DoubanProxyType,
    ),
    BangumiDataSource: normalizeSiteBangumiDataSource(
      config.SiteConfig.BangumiDataSource,
    ),
    DoubanImageProxyType: normalizeSiteDoubanImageProxyType(
      config.SiteConfig.DoubanImageProxyType,
    ),
    SourceCoverProxyMode: normalizeSourceCoverProxyMode(
      config.SiteConfig.SourceCoverProxyMode,
    ),
    EnableLiveEntry: config.SiteConfig.EnableLiveEntry ?? false,
    DefaultAggregateSearch: config.SiteConfig.DefaultAggregateSearch ?? true,
    EnableOptimization: config.SiteConfig.EnableOptimization ?? true,
    LiveDirectConnect: config.SiteConfig.LiveDirectConnect ?? false,
    AutoSwitchSource: config.SiteConfig.AutoSwitchSource ?? false,
    EnableDanmaku: config.SiteConfig.EnableDanmaku ?? false,
    EnableUserDanmaku: config.SiteConfig.EnableUserDanmaku ?? false,
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
    FooterText: value.FooterText || DEFAULT_SITE_FOOTER_TEXT,
    EnableLiveEntry: value.EnableLiveEntry ?? false,
    DefaultAggregateSearch: value.DefaultAggregateSearch ?? true,
    EnableOptimization: value.EnableOptimization ?? true,
    LiveDirectConnect: value.LiveDirectConnect ?? false,
    AutoSwitchSource: value.AutoSwitchSource ?? false,
    EnableDanmaku: value.EnableDanmaku ?? false,
    EnableUserDanmaku: value.EnableUserDanmaku ?? false,
    DoubanProxyType: normalizeSiteDoubanProxyType(value.DoubanProxyType),
    BangumiDataSource: normalizeSiteBangumiDataSource(value.BangumiDataSource),
    DoubanImageProxyType: normalizeSiteDoubanImageProxyType(
      value.DoubanImageProxyType,
    ),
    SourceCoverProxyMode: normalizeSourceCoverProxyMode(
      value.SourceCoverProxyMode,
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
  const [pendingIconFile, setPendingIconFile] = useState<File | null>(null);
  const iconFileRef = useRef<HTMLInputElement>(null);
  const iconPreviewObjectUrlRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const [danmakuTesting, setDanmakuTesting] = useState(false);
  const [danmakuTestResult, setDanmakuTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const normalizedSiteSettings = normalizeEditableSiteSettings(siteSettings);
  const siteSettingsDirty =
    JSON.stringify(normalizedSiteSettings) !==
      JSON.stringify(baselineSiteSettings) || pendingIconFile !== null;

  const revokeIconPreviewObjectUrl = () => {
    if (!iconPreviewObjectUrlRef.current) return;
    URL.revokeObjectURL(iconPreviewObjectUrlRef.current);
    iconPreviewObjectUrlRef.current = null;
  };

  useEffect(() => {
    if (config?.SiteConfig) {
      const nextSiteSettings = buildSiteSettings(config);
      setSiteSettings(nextSiteSettings);
      setBaselineSiteSettings(normalizeEditableSiteSettings(nextSiteSettings));
      setPendingIconFile(null);
      revokeIconPreviewObjectUrl();
      // 初始化图标预览
      const icon = config.SiteConfig.SiteIcon;
      setIconPreview(
        icon ? (icon.startsWith('/') ? `${icon}?t=${Date.now()}` : icon) : '',
      );
    }
  }, [config]);

  useEffect(
    () => () => {
      revokeIconPreviewObjectUrl();
    },
    [],
  );

  useEffect(() => {
    onDirtyChange?.(siteSettingsDirty);
  }, [onDirtyChange, siteSettingsDirty]);

  // 处理豆瓣数据源变化
  const handleDoubanDataSourceChange = (value: string) => {
    setSiteSettings((prev) => ({
      ...prev,
      DoubanProxyType: value,
    }));
  };

  const handleBangumiDataSourceChange = (value: string) => {
    const nextSource = normalizeSiteBangumiDataSource(value);
    setSiteSettings((prev) => ({
      ...prev,
      BangumiDataSource: nextSource,
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
    siteConfigKey: LocalPreferenceToggleSiteConfigKey,
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
        let stagingToken: string | undefined;
        if (pendingIconFile) {
          setIconUploading(true);
          const formData = new FormData();
          formData.append('icon', pendingIconFile);
          const response = await fetch('/api/admin/site-icon', {
            method: 'POST',
            body: formData,
          });
          const data = (await response.json()) as {
            error?: string;
            stagingToken?: string;
          };
          if (!response.ok || !data.stagingToken) {
            throw new Error(data.error || '图标上传失败');
          }
          stagingToken = data.stagingToken;
        }

        const removeSiteIcon =
          baselineSiteSettings.SiteIcon.startsWith('/api/admin/site-icon') &&
          !normalizedSiteSettings.SiteIcon.startsWith('/api/admin/site-icon');
        await adminPost(
          '/api/admin/site',
          {
            ...siteSettings,
            ...(stagingToken ? { SiteIconStagingToken: stagingToken } : {}),
            ...(removeSiteIcon ? { RemoveSiteIcon: true } : {}),
          },
          '保存失败',
        );

        setBaselineSiteSettings(normalizedSiteSettings);
        setPendingIconFile(null);
        revokeIconPreviewObjectUrl();
        showSuccess('保存成功, 请刷新页面', showAlert);
        await refreshConfig();
      });
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败', showAlert);
    } finally {
      setIconUploading(false);
      savingRef.current = false;
      onSavingChange?.(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSave();
  };

  const handleDanmakuTest = async () => {
    if (danmakuTesting) return;

    setDanmakuTesting(true);
    setDanmakuTestResult(null);

    try {
      const response = await fetch('/api/admin/danmaku/test', {
        method: 'POST',
      });
      const data = (await response.json()) as {
        success: boolean;
        error?: string;
        message?: string;
        details?: string;
      };

      if (data.success) {
        setDanmakuTestResult({
          success: true,
          message: data.message || '弹幕服务测试成功',
        });
      } else {
        setDanmakuTestResult({
          success: false,
          message: data.details || data.error || '测试失败',
        });
      }
    } catch (error) {
      setDanmakuTestResult({
        success: false,
        message: error instanceof Error ? error.message : '网络请求失败',
      });
    } finally {
      setDanmakuTesting(false);
    }
  };

  if (!config) {
    return null;
  }

  return (
    <form
      id={SITE_CONFIG_FORM_ID}
      onSubmit={handleSubmit}
      className='space-y-6'
    >
      <AdminSettingsGroup title='基本信息'>
        <AdminSettingRow label='站点名称' htmlFor='site-name'>
          <input
            id='site-name'
            name='siteName'
            type='text'
            value={siteSettings.SiteName}
            onChange={(e) =>
              setSiteSettings((prev) => ({ ...prev, SiteName: e.target.value }))
            }
            className={`${inputStyles.withFocus} w-full sm:w-80`}
          />
        </AdminSettingRow>
        <AdminSettingRow label='站点图标' htmlFor='site-icon'>
          <div className='flex w-full min-w-0 items-start gap-3 sm:w-[32rem]'>
            <div className='flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-50 ring-1 ring-inset ring-gray-200 dark:bg-gray-800 dark:ring-gray-700'>
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
              <div className='flex min-w-0 flex-wrap items-center gap-2'>
                <input
                  id='site-icon'
                  name='siteIcon'
                  type='text'
                  value={siteSettings.SiteIcon}
                  onChange={(e) => {
                    const url = e.target.value;
                    setPendingIconFile(null);
                    revokeIconPreviewObjectUrl();
                    setSiteSettings((prev) => ({ ...prev, SiteIcon: url }));
                    setIconPreview(url);
                  }}
                  placeholder='输入图标 URL 或上传文件'
                  className={`${inputStyles.withFocus} min-w-0 flex-1 basis-48`}
                />
                <div className='flex shrink-0 items-center gap-2'>
                  <button
                    type='button'
                    disabled={iconUploading}
                    onClick={() => iconFileRef.current?.click()}
                    aria-label={iconUploading ? '上传中' : '上传图标'}
                    title={iconUploading ? '上传中...' : '上传图标'}
                    className={`${buttonStyles.outline} flex h-10 w-10 shrink-0 items-center justify-center !p-0 disabled:opacity-60`}
                  >
                    <Upload className='h-5 w-5' />
                  </button>
                  {siteSettings.SiteIcon && (
                    <button
                      type='button'
                      onClick={() => {
                        setPendingIconFile(null);
                        revokeIconPreviewObjectUrl();
                        setSiteSettings((prev) => ({ ...prev, SiteIcon: '' }));
                        setIconPreview('');
                      }}
                      className={`${buttonStyles.outline} flex shrink-0 items-center gap-1.5`}
                    >
                      <Trash2 className='h-3.5 w-3.5' />
                      清除
                    </button>
                  )}
                </div>
              </div>
              <input
                id='site-icon-file'
                name='siteIconFile'
                ref={iconFileRef}
                type='file'
                aria-label='上传站点图标'
                accept='image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/x-icon'
                className='hidden'
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 512 * 1024) {
                    showError('图标文件不能超过 512KB', showAlert);
                    e.target.value = '';
                    return;
                  }
                  revokeIconPreviewObjectUrl();
                  const previewUrl = URL.createObjectURL(file);
                  iconPreviewObjectUrlRef.current = previewUrl;
                  setPendingIconFile(file);
                  setSiteSettings((prev) => ({
                    ...prev,
                    SiteIcon: '/api/admin/site-icon',
                  }));
                  setIconPreview(previewUrl);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        </AdminSettingRow>
        <AdminSettingRow
          label='站点公告'
          htmlFor='site-announcement'
          description='修改后会重新推送给用户'
          layout='stacked'
        >
          <textarea
            id='site-announcement'
            name='siteAnnouncement'
            value={siteSettings.Announcement}
            onChange={(e) =>
              setSiteSettings((prev) => ({
                ...prev,
                Announcement: e.target.value,
              }))
            }
            rows={3}
            className={`${inputStyles.withFocus} block w-full resize-y`}
          />
        </AdminSettingRow>
        <AdminSettingRow
          label='底部声明'
          htmlFor='site-footer-text'
          layout='stacked'
        >
          <textarea
            id='site-footer-text'
            name='siteFooterText'
            placeholder='留空使用默认文案'
            value={siteSettings.FooterText}
            onChange={(e) =>
              setSiteSettings((prev) => ({
                ...prev,
                FooterText: e.target.value,
              }))
            }
            rows={3}
            className={`${inputStyles.withFocus} block w-full resize-y`}
          />
        </AdminSettingRow>
      </AdminSettingsGroup>

      <AdminSettingsGroup title='数据与图片代理'>
        <AdminSettingRow
          label='豆瓣数据代理'
          htmlFor='site-douban-proxy-type'
          labelAddon={
            getThanksInfo(siteSettings.DoubanProxyType) && (
              <button
                type='button'
                onClick={() =>
                  window.open(
                    getThanksInfo(siteSettings.DoubanProxyType)!.url,
                    '_blank',
                  )
                }
                className='inline-flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              >
                <span className='font-medium'>
                  {getThanksInfo(siteSettings.DoubanProxyType)!.text}
                </span>
                <ExternalLink className='h-3 w-3 opacity-70' />
              </button>
            )
          }
        >
          <AdminSelect
            id='site-douban-proxy-type'
            value={siteSettings.DoubanProxyType}
            onChange={(value) => handleDoubanDataSourceChange(value)}
            options={siteDoubanDataSourceOptions}
            className='w-full sm:w-80'
          />
        </AdminSettingRow>
        <AdminSettingRow
          label='豆瓣图片代理'
          htmlFor='site-douban-image-proxy-type'
          labelAddon={
            getThanksInfo(siteSettings.DoubanImageProxyType) && (
              <button
                type='button'
                onClick={() =>
                  window.open(
                    getThanksInfo(siteSettings.DoubanImageProxyType)!.url,
                    '_blank',
                  )
                }
                className='inline-flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              >
                <span className='font-medium'>
                  {getThanksInfo(siteSettings.DoubanImageProxyType)!.text}
                </span>
                <ExternalLink className='h-3 w-3 opacity-70' />
              </button>
            )
          }
        >
          <AdminSelect
            id='site-douban-image-proxy-type'
            value={siteSettings.DoubanImageProxyType}
            onChange={(value) => handleDoubanImageProxyChange(value)}
            options={siteDoubanImageProxyTypeOptions}
            className='w-full sm:w-80'
          />
        </AdminSettingRow>
        <AdminSettingRow
          label='Bangumi 数据代理'
          htmlFor='site-bangumi-data-source'
        >
          <AdminSelect
            id='site-bangumi-data-source'
            value={siteSettings.BangumiDataSource}
            onChange={(value) => handleBangumiDataSourceChange(value)}
            options={siteBangumiDataSourceOptions}
            className='w-full sm:w-80'
          />
        </AdminSettingRow>
        <AdminSettingRow
          label='源站封面加载'
          htmlFor='site-source-cover-proxy-mode'
        >
          <AdminSelect
            id='site-source-cover-proxy-mode'
            value={siteSettings.SourceCoverProxyMode}
            onChange={(value) =>
              setSiteSettings((prev) => ({
                ...prev,
                SourceCoverProxyMode: normalizeSourceCoverProxyMode(value),
              }))
            }
            options={sourceCoverProxyModeOptions}
            className='w-full sm:w-80'
          />
        </AdminSettingRow>
      </AdminSettingsGroup>

      <AdminSettingsGroup title='功能'>
        <AdminSettingRow label='显示直播入口' layout='inline'>
          <AdminStatusSwitch
            enabled={siteSettings.EnableLiveEntry}
            ariaLabel='切换直播入口显示'
            onToggle={() =>
              setSiteSettings((prev) => ({
                ...prev,
                EnableLiveEntry: !prev.EnableLiveEntry,
              }))
            }
          />
        </AdminSettingRow>
        <AdminSettingRow label='NSFW 模式' layout='inline'>
          <AdminStatusSwitch
            enabled={siteSettings.DisableYellowFilter}
            ariaLabel='切换NSFW模式'
            onToggle={() =>
              setSiteSettings((prev) => ({
                ...prev,
                DisableYellowFilter: !prev.DisableYellowFilter,
              }))
            }
          />
        </AdminSettingRow>
        <AdminSettingRow
          label='播放器弹幕'
          layout='inline'
          labelAddon={
            danmakuTestResult && (
              <span
                role='status'
                className={`flex min-w-0 items-start gap-1.5 text-xs ${
                  danmakuTestResult.success
                    ? 'text-brand-600 dark:text-brand-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {danmakuTestResult.success ? (
                  <CheckCircle2 className='mt-0.5 h-3.5 w-3.5 flex-shrink-0' />
                ) : (
                  <XCircle className='mt-0.5 h-3.5 w-3.5 flex-shrink-0' />
                )}
                <span className='min-w-0 break-words'>
                  {danmakuTestResult.message}
                </span>
              </span>
            )
          }
        >
          <button
            type='button'
            onClick={handleDanmakuTest}
            disabled={danmakuTesting}
            className={`${buttonStyles.outline} flex items-center gap-1.5 whitespace-nowrap !text-xs disabled:cursor-not-allowed disabled:opacity-60`}
            aria-label={danmakuTesting ? '测试中' : '测试弹幕连接'}
          >
            {danmakuTesting ? (
              <>
                <Spinner className='h-3.5 w-3.5' />
                测试中
              </>
            ) : (
              '测试连接'
            )}
          </button>
          <AdminStatusSwitch
            enabled={siteSettings.EnableDanmaku}
            ariaLabel='切换播放器弹幕'
            onToggle={() =>
              setSiteSettings((prev) => ({
                ...prev,
                EnableDanmaku: !prev.EnableDanmaku,
              }))
            }
          />
        </AdminSettingRow>
        {siteSettings.EnableDanmaku && (
          <AdminSettingRow label='用户发送弹幕' layout='inline'>
            <AdminStatusSwitch
              enabled={siteSettings.EnableUserDanmaku}
              ariaLabel='切换用户发送弹幕'
              onToggle={() =>
                setSiteSettings((prev) => ({
                  ...prev,
                  EnableUserDanmaku: !prev.EnableUserDanmaku,
                }))
              }
            />
          </AdminSettingRow>
        )}
      </AdminSettingsGroup>

      <AdminSettingsGroup title='本地设置默认值'>
        {localPreferenceToggleDefinitions.map((definition) => {
          const enabled = siteSettings[definition.siteConfigKey];

          return (
            <AdminSettingRow
              key={definition.id}
              label={definition.title}
              description={definition.description}
              layout='inline'
            >
              <AdminStatusSwitch
                enabled={enabled}
                ariaLabel={`切换${definition.title}`}
                onToggle={() =>
                  handleLocalPreferenceDefaultToggle(definition.siteConfigKey)
                }
              />
            </AdminSettingRow>
          );
        })}
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

export default SiteConfigComponent;
