'use client';

import { createContext, useContext } from 'react';

import {
  ListEmptySkeleton,
  ListLoadingState,
  SearchingState,
} from '@/components/ListState';
import SkeletonText from '@/components/SkeletonText';
import AdminListToolbar from '@/features/admin/components/AdminListToolbar';
import {
  ADMIN_PANEL_CLASS,
  AdminSettingRow,
  AdminSettingsGroup,
} from '@/features/admin/components/AdminSettings';
import {
  LOGIN_PROVIDER_ICON_CLASS,
  LOGIN_PROVIDER_ROW_CLASS,
} from '@/features/admin/components/tabs/registration/layout';
import { TrafficTabSkeleton } from '@/features/admin/components/tabs/traffic/TrafficUsageCard';
import type { AdminTabId } from '@/features/admin/lib/admin-tabs';
import {
  ANNOUNCEMENT_ACTION_CLASS,
  ANNOUNCEMENT_COMPOSER_CLASS,
  ANNOUNCEMENT_COMPOSER_ROWS,
  ANNOUNCEMENT_EMPTY_CLASS,
  ANNOUNCEMENT_META_CLASS,
  ANNOUNCEMENT_ROW_CLASS,
  ANNOUNCEMENT_SKELETON_MAX_ROWS,
  ANNOUNCEMENT_TEXT_CLASS,
} from '@/features/admin/lib/announcement-layout';
import { getKnownAdminListCount } from '@/features/admin/lib/list-counts';
import {
  ADMIN_LIST_COMPACT_EMPTY_CLASS,
  ADMIN_LIST_EMPTY_CLASS,
} from '@/features/admin/lib/list-layout';
import { COMMON_RUNTIME_PARAM_GROUPS } from '@/features/admin/lib/runtime-param-fields';
import {
  USER_DANMAKU_ACTION_CLASS,
  USER_DANMAKU_HEADER_CLASS,
  USER_DANMAKU_META_CLASS,
  USER_DANMAKU_ROW_CLASS,
  USER_DANMAKU_TEXT_CLASS,
} from '@/features/admin/lib/user-danmaku-layout';
import { ADMIN_USER_PAGE_SIZE } from '@/features/admin/lib/user-query';
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
            ? 'h-9 w-full rounded-lg'
            : inline
              ? 'h-6 w-11 rounded-full'
              : 'h-9 w-full rounded-lg sm:w-80'
        }
      />
    </AdminSettingRow>
  );
}

export function AdminUserRowsSkeleton({
  count,
  searching = false,
}: {
  count?: number;
  searching?: boolean;
}) {
  return (
    <SourceRows
      count={
        count === undefined ? undefined : Math.min(count, ADMIN_USER_PAGE_SIZE)
      }
      tab='user'
      searching={searching}
    />
  );
}

function SourceRows({
  count,
  tab,
  userGroup = false,
  searching = false,
}: {
  count?: number;
  searching?: boolean;
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
        {searching ? (
          <SearchingState className={ADMIN_LIST_EMPTY_CLASS} />
        ) : count === undefined ? (
          <ListLoadingState
            className={
              userGroup
                ? ADMIN_LIST_COMPACT_EMPTY_CLASS
                : ADMIN_LIST_EMPTY_CLASS
            }
          />
        ) : count === 0 ? (
          <ListEmptySkeleton
            className={
              userGroup
                ? ADMIN_LIST_COMPACT_EMPTY_CLASS
                : ADMIN_LIST_EMPTY_CLASS
            }
          />
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
  tab,
  userGroups = false,
}: {
  tab: AdminTabId;
  userGroups?: boolean;
}) {
  const user = tab === 'user';
  return (
    <AdminListToolbar
      search={<Block className='h-9 w-full rounded-lg' />}
      filters={
        <>
          <Block className='h-8 w-24 rounded-full' />
          {(user || tab === 'video-source') && (
            <>
              <Block className='h-8 w-24 rounded-full' />
              {user && userGroups && (
                <Block className='h-8 w-24 rounded-full' />
              )}
              <Block className='h-8 w-24 rounded-full' />
            </>
          )}
        </>
      }
      actions={
        <>
          {user && <Block className='h-8 w-24 rounded-lg' />}
          <Block className='h-8 w-24 rounded-lg' />
        </>
      }
    />
  );
}

export function AdminUserDanmakuRowsSkeleton({
  count = getKnownAdminListCount('danmaku'),
}: { count?: number } = {}) {
  if (count === undefined)
    return <ListLoadingState className={ADMIN_LIST_EMPTY_CLASS} />;
  if (count === 0)
    return <ListEmptySkeleton className={ADMIN_LIST_EMPTY_CLASS} />;
  return (
    <div
      role='status'
      className='divide-y divide-gray-200 dark:divide-white/[0.06]'
    >
      <span className='sr-only'>加载中...</span>
      {Array.from({ length: count }, (_, index) => (
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

export function AdminAnnouncementRowsSkeleton({ count }: { count?: number }) {
  if (count === undefined)
    return <ListLoadingState className={ANNOUNCEMENT_EMPTY_CLASS} />;
  if (count === 0)
    return <ListEmptySkeleton className={ANNOUNCEMENT_EMPTY_CLASS} />;
  const rows = Math.min(count, ANNOUNCEMENT_SKELETON_MAX_ROWS);
  return (
    <div
      role='status'
      className='divide-y divide-gray-200 dark:divide-white/[0.06]'
    >
      <span className='sr-only'>加载中...</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={ANNOUNCEMENT_ROW_CLASS}>
          <div className='min-w-0 flex-1'>
            <SkeletonText
              className={ANNOUNCEMENT_TEXT_CLASS}
              barClassName='h-3.5 w-3/4 rounded'
            />
            <SkeletonText
              className={ANNOUNCEMENT_META_CLASS}
              barClassName='h-3 w-28 rounded'
            />
          </div>
          <Block
            className={`${ANNOUNCEMENT_ACTION_CLASS} w-8 shrink-0 rounded-lg`}
          />
        </div>
      ))}
    </div>
  );
}

export function AdminReviewRowsSkeleton({
  count = getKnownAdminListCount('reviews'),
}: { count?: number } = {}) {
  if (count === undefined)
    return <ListLoadingState className={ADMIN_LIST_EMPTY_CLASS} />;
  if (count === 0)
    return <ListEmptySkeleton className={ADMIN_LIST_EMPTY_CLASS} />;
  return (
    <div
      role='status'
      className='divide-y divide-gray-200 dark:divide-gray-700'
    >
      <span className='sr-only'>加载中...</span>
      {Array.from({ length: count }, (_, index) => (
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
            <Field label='站点须知' wide />
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
    case 'user':
      content = (
        <div className='space-y-6'>
          <div>
            <h2 className='mb-3 text-base font-semibold text-gray-900 dark:text-gray-100'>
              用户列表
            </h2>
            <div className='mb-4'>
              <SearchToolbar
                tab='user'
                userGroups={!!data?.UserConfig.Tags?.length}
              />
            </div>
            <AdminUserRowsSkeleton count={data?.UserConfig.TotalUsers} />
          </div>
          <div>
            <div className='mb-3 flex items-center justify-between'>
              <h2 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                用户组
              </h2>
              <Block className='h-8 w-24 rounded-lg' />
            </div>
            <SourceRows
              count={data ? (data.UserConfig.Tags?.length ?? 0) : undefined}
              tab={tab}
              userGroup
            />
          </div>
        </div>
      );
      break;
    case 'registration':
      content = (
        <div className='space-y-8'>
          <AdminSettingsGroup title='注册'>
            <Field label='开放注册' inline />
            {data?.UserConfig.OpenRegister && (
              <AdminSettingRow label='注册通道' layout='inline'>
                <div className='flex gap-1.5'>
                  <Block className='h-8 w-12 rounded-full' />
                  <Block className='h-8 w-[5.5rem] rounded-full' />
                </div>
              </AdminSettingRow>
            )}
            {!!data?.UserConfig.Tags?.length && (
              <AdminSettingRow label='新用户默认用户组' layout='inline'>
                <Block className='h-8 w-20 rounded-full' />
              </AdminSettingRow>
            )}
          </AdminSettingsGroup>
          <AdminSettingsGroup title='登录方式'>
            <div className={LOGIN_PROVIDER_ROW_CLASS}>
              <Block className={`${LOGIN_PROVIDER_ICON_CLASS} rounded-full`} />
              <div className='min-w-0 flex-1'>
                <div className='flex h-5 items-center'>
                  <Block className='h-3.5 w-16' />
                </div>
                <div className='mt-0.5 flex h-4 items-center'>
                  <Block className='h-3 w-28 max-w-full' />
                </div>
              </div>
              <Block className='h-8 w-[4.5rem] shrink-0 rounded-lg' />
              <Block className='h-6 w-11 shrink-0 rounded-full' />
            </div>
          </AdminSettingsGroup>
          <AdminSettingsGroup title='邀请码'>
            <Field label='注册需要邀请码' inline />
            <AdminSettingRow label='有效邀请码' layout='inline'>
              <Block className='h-4 w-12' />
              <Block className='h-8 w-[4.5rem] rounded-lg' />
            </AdminSettingRow>
          </AdminSettingsGroup>
        </div>
      );
      break;
    case 'announcements':
      content = (
        <div className='space-y-8'>
          <AdminSettingsGroup
            title='发布公告'
            actions={
              <>
                <Block className='h-8 w-20 rounded-lg' />
                <Block className='h-8 w-[4.5rem] rounded-lg' />
              </>
            }
          >
            <textarea
              aria-hidden='true'
              tabIndex={-1}
              disabled
              rows={ANNOUNCEMENT_COMPOSER_ROWS}
              className={ANNOUNCEMENT_COMPOSER_CLASS}
            />
          </AdminSettingsGroup>
          <AdminSettingsGroup title='公告列表'>
            <AdminAnnouncementRowsSkeleton
              count={data?.SiteConfig.AnnouncementCount}
            />
          </AdminSettingsGroup>
        </div>
      );
      break;
    case 'danmaku':
      content = (
        <div className='space-y-5'>
          <AdminListToolbar
            search={<Block className='h-9 w-full rounded-lg' />}
          />
          <div className={ADMIN_PANEL_CLASS}>
            <div className={USER_DANMAKU_HEADER_CLASS}>
              <Block className='h-4 w-4 shrink-0' />
              <Block className='h-3 w-20' />
            </div>
            <AdminUserDanmakuRowsSkeleton />
          </div>
        </div>
      );
      break;
    case 'traffic':
      content = <TrafficTabSkeleton />;
      break;
    case 'reviews':
      content = (
        <div className='space-y-5'>
          <AdminListToolbar
            search={<Block className='h-9 w-full rounded-lg' />}
            filters={<Block className='h-9 w-64 rounded-lg' />}
          />
          <div className={ADMIN_PANEL_CLASS}>
            <AdminReviewRowsSkeleton />
          </div>
        </div>
      );
      break;
    default: {
      const count = !data
        ? undefined
        : tab === 'video-source'
          ? data.SourceConfig.length
          : tab === 'live-source'
            ? (data.LiveConfig?.length ?? 0)
            : data.CustomCategories.length;
      content = (
        <div className='space-y-6'>
          <SearchToolbar tab={tab} />
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
