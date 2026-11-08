'use client';

import { createContext, useContext } from 'react';

import SkeletonText from '@/components/SkeletonText';
import {
  ADMIN_PANEL_CLASS,
  AdminSettingRow,
  AdminSettingsGroup,
} from '@/features/admin/components/AdminSettings';
import { RegistrationSummaryCardSkeleton } from '@/features/admin/components/tabs/user-config/RegistrationSummaryCard';
import type { AdminTabId } from '@/features/admin/lib/admin-tabs';
import { COMMON_RUNTIME_PARAM_GROUPS } from '@/features/admin/lib/runtime-param-fields';
import {
  USER_DANMAKU_ACTION_CLASS,
  USER_DANMAKU_META_CLASS,
  USER_DANMAKU_ROW_CLASS,
  USER_DANMAKU_TEXT_CLASS,
  USER_DANMAKU_TOOLBAR_CLASS,
} from '@/features/admin/lib/user-danmaku-layout';
import { localPreferenceToggleDefinitions } from '@/lib/local-preference-toggles';
import type { AdminConfig } from '@/types/admin';

export const AdminSkeletonContext = createContext<{
  activeTab: AdminTabId;
  config: AdminConfig | null;
}>({ activeTab: 'site', config: null });

function Block({ className = 'h-4 w-24' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />;
}

function Field({
  label,
  wide = false,
  description,
  inline = false,
}: {
  label: string;
  wide?: boolean;
  description?: string;
  inline?: boolean;
}) {
  return (
    <AdminSettingRow
      label={label}
      description={description}
      layout={wide ? 'stacked' : inline ? 'inline' : 'responsive'}
    >
      <Block
        className={
          wide
            ? 'h-[76px] w-full rounded-lg'
            : inline
              ? 'h-6 w-11 rounded-full'
              : 'h-9 w-full rounded-lg sm:w-80'
        }
      />
    </AdminSettingRow>
  );
}

export function AdminUserRowsSkeleton({ count = 50 }: { count?: number }) {
  return <SourceRows count={Math.min(count, 50)} tab='user' />;
}

function SourceRows({
  count,
  tab,
  userGroup = false,
}: {
  count: number;
  tab: AdminTabId;
  userGroup?: boolean;
}) {
  return (
    <div className={ADMIN_PANEL_CLASS}>
      {!userGroup && (
        <div className='flex h-10 items-center gap-3 rounded-t-xl bg-gray-50 px-3 dark:bg-white/[0.03]'>
          {(tab === 'video-source' || tab === 'user') && (
            <Block className='h-4 w-4 shrink-0' />
          )}
          <Block className='h-3 w-16' />
          {tab === 'live-source' && (
            <Block className='ml-auto h-8 w-24 rounded-lg' />
          )}
        </div>
      )}
      <div className='divide-y divide-gray-200 dark:divide-white/[0.06]'>
        {count === 0 ? (
          <div
            className={`flex justify-center px-6 ${userGroup ? 'py-8' : 'py-12'}`}
          >
            <Block className='h-5 w-28' />
          </div>
        ) : (
          Array.from({ length: count }, (_, index) => (
            <div
              key={index}
              className='flex flex-wrap items-center gap-3 px-3 py-3'
            >
              {!userGroup && <Block className='h-4 w-4 shrink-0' />}
              {tab === 'video-source' && <Block className='h-4 w-4 shrink-0' />}
              <div className='min-w-0 flex-1'>
                <div className='flex h-5 items-center'>
                  <Block className='h-3.5 w-32 max-w-full' />
                </div>
                <div className='mt-1 flex h-4 items-center'>
                  <Block className='h-3 w-48 max-w-full' />
                </div>
              </div>
              <div
                className={
                  tab === 'user'
                    ? 'shrink-0'
                    : 'flex w-full shrink-0 items-center justify-end gap-3 sm:w-auto'
                }
              >
                {tab === 'video-source' && (
                  <>
                    <Block className='hidden h-3 w-28 md:block' />
                    <Block className='h-8 w-20 rounded-full' />
                  </>
                )}
                {tab !== 'user' && <Block className='h-6 w-11 rounded-full' />}
                <Block className='h-8 w-8 rounded-lg' />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SearchToolbar({
  user = false,
  live = false,
  userGroups = false,
}: {
  user?: boolean;
  live?: boolean;
  userGroups?: boolean;
}) {
  if (user) {
    return (
      <div className='mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          <Block className='h-9 w-full rounded-lg sm:w-64' />
          <Block className='h-8 w-16 shrink-0 rounded-full' />
          {userGroups && <Block className='h-8 w-24 shrink-0 rounded-full' />}
          <Block className='h-8 w-24 shrink-0 rounded-full' />
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <Block className='h-8 w-24 rounded-lg' />
          <Block className='h-8 w-24 rounded-lg' />
        </div>
      </div>
    );
  }
  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='min-w-0 flex-1 sm:w-72 sm:flex-none'>
        <Block className='h-9 w-full rounded-lg' />
      </div>
      <div className='flex shrink-0 items-center gap-2'>
        {live && <Block className='h-8 w-24 rounded-lg' />}
        <Block className='h-8 w-24 rounded-lg' />
      </div>
    </div>
  );
}

export function AdminUserDanmakuRowsSkeleton() {
  return (
    <div
      role='status'
      className='divide-y divide-gray-200 dark:divide-white/[0.06]'
    >
      <span className='sr-only'>加载中...</span>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className={USER_DANMAKU_ROW_CLASS}>
          <Block className='h-4 w-4 shrink-0 rounded' />
          <div className='min-w-0 flex-1'>
            <SkeletonText
              className={USER_DANMAKU_TEXT_CLASS}
              barClassName='h-3.5 w-1/2 rounded'
            />
            <SkeletonText
              className={USER_DANMAKU_META_CLASS}
              barClassName='h-3 w-2/3 rounded'
            />
          </div>
          <div className={`${USER_DANMAKU_ACTION_CLASS} shrink-0`} />
        </div>
      ))}
    </div>
  );
}

export function AdminReviewRowsSkeleton() {
  return (
    <div
      role='status'
      className='divide-y divide-gray-200 dark:divide-gray-700'
    >
      <span className='sr-only'>加载中...</span>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className='flex gap-3 p-4 sm:gap-4'>
          <Block className='h-20 w-14 shrink-0 rounded-md sm:h-24 sm:w-16' />
          <div className='min-w-0 flex-1 space-y-3'>
            <Block className='h-6 w-40 max-w-full' />
            <Block className='h-5 w-32 max-w-full' />
            <Block className='h-5 w-3/4' />
            <Block className='h-5 w-1/2' />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminContentSkeleton({
  activeTab,
  config,
}: {
  activeTab?: AdminTabId;
  config?: AdminConfig | null;
}) {
  const context = useContext(AdminSkeletonContext);
  const tab = activeTab ?? context.activeTab;
  const data = config === undefined ? context.config : config;
  let content;
  switch (tab) {
    case 'site':
      content = (
        <div className='space-y-6'>
          <AdminSettingsGroup title='基本信息'>
            <Field label='站点名称' />
            <AdminSettingRow label='站点图标'>
              <div className='flex w-full gap-3 sm:w-[32rem]'>
                <Block className='h-10 w-10 shrink-0 rounded-lg' />
                <Block className='h-10 min-w-0 flex-1 rounded-lg' />
                <Block className='h-10 w-10 shrink-0 rounded-lg' />
              </div>
            </AdminSettingRow>
            <Field label='站点公告' description='修改后会重新推送给用户' wide />
            <Field label='底部声明' wide />
          </AdminSettingsGroup>
          <AdminSettingsGroup title='数据与图片代理'>
            {[
              '豆瓣数据代理',
              '豆瓣图片代理',
              'Bangumi 数据代理',
              '源站封面加载',
            ].map((label) => (
              <Field key={label} label={label} />
            ))}
          </AdminSettingsGroup>
          <AdminSettingsGroup title='功能'>
            {['显示直播入口', 'NSFW 模式', '播放器弹幕'].map((label) => (
              <Field key={label} label={label} inline />
            ))}
          </AdminSettingsGroup>
          <AdminSettingsGroup title='本地设置默认值'>
            {localPreferenceToggleDefinitions.map((definition) => (
              <Field
                key={definition.id}
                label={definition.title}
                description={definition.description}
                inline
              />
            ))}
          </AdminSettingsGroup>
        </div>
      );
      break;
    case 'runtime':
      content = (
        <div className='space-y-8'>
          {COMMON_RUNTIME_PARAM_GROUPS.map((group) => (
            <AdminSettingsGroup key={group.id} title={group.title}>
              {group.fields.map((field) => (
                <AdminSettingRow
                  key={field.key}
                  label={field.label}
                  description={field.hint}
                >
                  <Block className='h-9 w-32 rounded-lg' />
                  <div className='h-8 w-8 shrink-0' />
                </AdminSettingRow>
              ))}
            </AdminSettingsGroup>
          ))}
          <div className='flex h-8 items-center'>
            <Block className='h-5 w-24' />
          </div>
        </div>
      );
      break;
    case 'config-file':
      content = (
        <div className='space-y-8'>
          <AdminSettingsGroup title='配置订阅'>
            <AdminSettingRow label='订阅地址'>
              <Block className='h-9 w-full rounded-lg sm:w-96' />
            </AdminSettingRow>
            <Field label='自动更新' inline />
          </AdminSettingsGroup>
          <AdminSettingsGroup
            title='配置内容'
            actions={
              <>
                <Block className='h-8 w-16 rounded-lg' />
                <Block className='h-8 w-16 rounded-lg' />
              </>
            }
          >
            <div className='min-h-[32rem] space-y-3 px-4 py-3'>
              {Array.from({ length: 12 }, (_, index) => (
                <Block
                  key={index}
                  className={index % 3 ? 'h-4 w-2/3' : 'h-4 w-1/3'}
                />
              ))}
            </div>
          </AdminSettingsGroup>
        </div>
      );
      break;
    case 'data-migration':
      content = (
        <div className='space-y-8'>
          <AdminSettingsGroup title='导出备份'>
            <AdminSettingRow
              label='加密密码'
              description='导入时需输入相同密码'
            >
              <Block className='h-9 w-full rounded-lg sm:w-96' />
            </AdminSettingRow>
            <AdminSettingRow label='备份内容' layout='stacked'>
              <div className='flex flex-wrap gap-1.5'>
                {Array.from({ length: 8 }, (_, index) => (
                  <Block key={index} className='h-5 w-20' />
                ))}
              </div>
              <Block className='mt-2 h-4 w-48 max-w-full' />
            </AdminSettingRow>
          </AdminSettingsGroup>
          <AdminSettingsGroup title='导入备份'>
            {['备份文件', '解密密码'].map((label) => (
              <AdminSettingRow key={label} label={label}>
                <Block className='h-9 w-full rounded-lg sm:w-96' />
              </AdminSettingRow>
            ))}
          </AdminSettingsGroup>
        </div>
      );
      break;
    case 'user':
      content = (
        <div className='space-y-6'>
          <RegistrationSummaryCardSkeleton />
          <div>
            <h2 className='mb-3 text-base font-semibold text-gray-900 dark:text-gray-100'>
              用户列表
            </h2>
            <SearchToolbar user userGroups={!!data?.UserConfig.Tags?.length} />
            <AdminUserRowsSkeleton count={data?.UserConfig.TotalUsers ?? 50} />
          </div>
          <div>
            <div className='mb-3 flex items-center justify-between'>
              <h2 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                用户组
              </h2>
              <Block className='h-8 w-24 rounded-lg' />
            </div>
            <SourceRows
              count={data ? (data.UserConfig.Tags?.length ?? 0) : 2}
              tab={tab}
              userGroup
            />
          </div>
        </div>
      );
      break;
    case 'danmaku':
      content = (
        <div className='space-y-5'>
          <div className={USER_DANMAKU_TOOLBAR_CLASS}>
            <Block className='h-9 w-24 rounded-lg' />
            <Block className='h-9 w-full rounded-lg sm:w-72' />
          </div>
          <div className={ADMIN_PANEL_CLASS}>
            <AdminUserDanmakuRowsSkeleton />
          </div>
        </div>
      );
      break;
    case 'reviews':
      content = (
        <div className='space-y-5'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <Block className='h-9 w-64 rounded-lg' />
            <Block className='h-9 w-full rounded-lg sm:w-72' />
          </div>
          <div className='overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700'>
            <AdminReviewRowsSkeleton />
          </div>
        </div>
      );
      break;
    default: {
      const count = !data
        ? 6
        : tab === 'video-source'
          ? data.SourceConfig.length
          : tab === 'live-source'
            ? (data.LiveConfig?.length ?? 0)
            : data.CustomCategories.length;
      content = (
        <div className='space-y-6'>
          <SearchToolbar live={tab === 'live-source'} />
          <SourceRows count={count} tab={tab} />
        </div>
      );
    }
  }
  return (
    <div aria-busy='true' aria-label='加载管理内容' inert>
      {content}
    </div>
  );
}
