'use client';

import { Settings2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { LinuxDoIcon } from '@/components/LinuxDoIcon';
import ConfirmModal from '@/components/modals/ConfirmModal';
import Select from '@/components/Select';
import {
  AdminSettingRow,
  AdminSettingsGroup,
} from '@/features/admin/components/AdminSettings';
import { AdminStatusSwitch } from '@/features/admin/components/AdminStatusSwitch';
import { InviteCodesDialog } from '@/features/admin/components/tabs/registration/InviteCodesDialog';
import {
  LOGIN_PROVIDER_ICON_CLASS,
  LOGIN_PROVIDER_ROW_CLASS,
} from '@/features/admin/components/tabs/registration/layout';
import {
  type LinuxDoSettingsDraft,
  LinuxDoSettingsDialog,
} from '@/features/admin/components/tabs/registration/LinuxDoSettingsDialog';
import { RegisterChannelChips } from '@/features/admin/components/tabs/registration/RegisterChannelChips';
import { useAdminInviteCodes } from '@/features/admin/hooks/useAdminInviteCodes';
import {
  type InviteCodeDraft,
  useAdminUserActions,
} from '@/features/admin/hooks/useAdminUserActions';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { ADMIN_USER_SEARCH_PARAM } from '@/features/admin/lib/admin-tabs';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { showError, showSuccess } from '@/features/admin/lib/notifications';
import { MAX_INVITE_CODES } from '@/features/admin/services/inviteCodes';
import { useModalState } from '@/hooks/useModalState';
import type { InviteCodeFilter } from '@/lib/invite-code-storage';
import type {
  AdminConfig,
  LinuxDoLoginSettings,
  RegisterChannels,
} from '@/types/admin';

export const DEFAULT_REGISTER_CHANNELS: RegisterChannels = {
  Password: true,
  LinuxDo: true,
};

export const DEFAULT_LINUXDO_SETTINGS: LinuxDoLoginSettings = {
  Enabled: false,
  MinTrustLevel: 1,
  ClientId: '',
  ClientSecret: '',
  RedirectUri: '',
};

function linuxDoStatus(configured: boolean, settings: LinuxDoLoginSettings) {
  if (!configured) return '未配置应用凭证';
  if (!settings.Enabled) return '未启用';
  return `最低信任等级 ${settings.MinTrustLevel}`;
}

interface RegistrationTabProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

export default function RegistrationTab({
  config,
  refreshConfig,
}: RegistrationTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isLoading, withLoading } = useLoadingState();
  const {
    createInviteCodes,
    deleteInviteCode,
    purgeInactiveInviteCodes,
    setRequireInviteCode,
    setLinuxDo,
    setLinuxDoCredentials,
    setRegisterChannels,
    setDefaultUserGroup,
    userAction,
  } = useAdminUserActions({ refreshConfig });

  const [showOpenRegisterConfirm, setShowOpenRegisterConfirm] = useState(false);
  const [linuxDoOpen, , openLinuxDo, closeLinuxDo] = useModalState(false);
  const [inviteOpen, , openInvite, closeInvite] = useModalState(false);
  const [showPurgeInviteConfirm, setShowPurgeInviteConfirm] = useState(false);
  const [inviteFilter, setInviteFilter] = useState<InviteCodeFilter>('all');
  const inviteList = useAdminInviteCodes(inviteFilter, inviteOpen);

  if (!config) return null;

  const userConfig = config.UserConfig;
  const openRegister = !!userConfig.OpenRegister;
  const requireInviteCode = !!userConfig.RequireInviteCode;
  const channels = userConfig.RegisterChannels ?? DEFAULT_REGISTER_CHANNELS;
  const linuxDo = userConfig.LinuxDo ?? DEFAULT_LINUXDO_SETTINGS;
  const linuxDoConfigured = !!userConfig.LinuxDoConfigured;
  const userGroupNames = (userConfig.Tags ?? []).map((group) => group.name);
  const activeInviteCodeCount = userConfig.activeInviteCodeCount ?? 0;

  // 开关类操作失败用提示条反馈，界面状态以刷新后的配置为准
  const run = (key: string, action: () => Promise<unknown>) =>
    withLoading(key, async () => {
      try {
        await action();
      } catch (error) {
        showError(error);
      }
    });

  const updateOpenRegister = (next: boolean) =>
    run('setOpenRegister', () =>
      userAction('setOpenRegister', undefined, undefined, undefined, next),
    );

  const handleToggleOpenRegister = () => {
    if (openRegister) void updateOpenRegister(false);
    else setShowOpenRegisterConfirm(true);
  };

  const handleSaveLinuxDo = async ({
    credentials,
    minTrustLevel,
  }: LinuxDoSettingsDraft) => {
    await setLinuxDoCredentials(credentials);
    if (minTrustLevel !== linuxDo.MinTrustLevel)
      await setLinuxDo({
        Enabled: linuxDo.Enabled,
        MinTrustLevel: minTrustLevel,
      });
  };

  const handleCreateInviteCodes = (draft: InviteCodeDraft) =>
    withLoading('createInviteCode', async () => {
      try {
        const codes = await createInviteCodes(draft);
        void inviteList.refresh();
        return codes;
      } catch (error) {
        showError(error, '生成邀请码失败');
        return null;
      }
    });

  const handleDeleteInviteCode = (code: string) =>
    withLoading(`deleteInviteCode_${code}`, async () => {
      try {
        await deleteInviteCode(code);
      } catch (error) {
        showError(error, '删除邀请码失败');
        // 邀请码可能已被其他管理员删除，拉一次最新摘要
        await refreshConfig().catch(() => undefined);
      }
      void inviteList.refresh();
    });

  const handlePurgeInactiveInviteCodes = () => {
    setShowPurgeInviteConfirm(false);
    void withLoading('purgeInactiveInviteCodes', async () => {
      try {
        const deleted = await purgeInactiveInviteCodes();
        if (deleted === 0) showSuccess('已清理 0 个失效邀请码');
      } catch (error) {
        showError(error);
      }
      void inviteList.refresh();
    });
  };

  const viewCodeUsers = (code: string) => {
    const params = new URLSearchParams({
      tab: 'user',
      [ADMIN_USER_SEARCH_PARAM]: code,
    });
    closeInvite();
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  return (
    <div className='space-y-8'>
      <AdminSettingsGroup title='注册'>
        <AdminSettingRow label='开放注册' layout='inline'>
          <AdminStatusSwitch
            enabled={openRegister}
            isLoading={isLoading('setOpenRegister')}
            ariaLabel='切换开放注册'
            onToggle={handleToggleOpenRegister}
          />
        </AdminSettingRow>
        {openRegister && (
          <AdminSettingRow label='注册通道' layout='inline'>
            <RegisterChannelChips
              channels={channels}
              linuxDoActive={linuxDo.Enabled && linuxDoConfigured}
              busy={isLoading('setRegisterChannels')}
              onChange={(next) =>
                void run('setRegisterChannels', () => setRegisterChannels(next))
              }
            />
          </AdminSettingRow>
        )}
        {userGroupNames.length > 0 && (
          <AdminSettingRow label='新用户默认用户组' layout='inline'>
            <Select
              value={userConfig.DefaultUserGroup || ''}
              onChange={(next) =>
                void run('setDefaultUserGroup', () => setDefaultUserGroup(next))
              }
              ariaLabel='新用户默认用户组'
              variant='pill'
              align='end'
              disabled={isLoading('setDefaultUserGroup')}
              options={[
                { value: '', label: '无' },
                ...userGroupNames.map((name) => ({ value: name, label: name })),
              ]}
            />
          </AdminSettingRow>
        )}
      </AdminSettingsGroup>

      <AdminSettingsGroup title='登录方式'>
        <div className={LOGIN_PROVIDER_ROW_CLASS}>
          <LinuxDoIcon className={LOGIN_PROVIDER_ICON_CLASS} />
          <div className='min-w-0 flex-1'>
            <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
              LinuxDo
            </p>
            <p className='mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400'>
              {linuxDoStatus(linuxDoConfigured, linuxDo)}
            </p>
          </div>
          <button
            type='button'
            onClick={openLinuxDo}
            className={`${buttonStyles.outline} inline-flex shrink-0 items-center gap-1.5`}
          >
            <Settings2 className='h-4 w-4' />
            配置
          </button>
          <AdminStatusSwitch
            enabled={linuxDo.Enabled}
            isLoading={
              isLoading('setLinuxDo') ||
              (!linuxDoConfigured && !linuxDo.Enabled)
            }
            ariaLabel='切换 LinuxDo 登录'
            onToggle={() =>
              void run('setLinuxDo', () =>
                setLinuxDo({
                  Enabled: !linuxDo.Enabled,
                  MinTrustLevel: linuxDo.MinTrustLevel,
                }),
              )
            }
          />
        </div>
      </AdminSettingsGroup>

      <AdminSettingsGroup title='邀请码'>
        <AdminSettingRow label='注册需要邀请码' layout='inline'>
          <AdminStatusSwitch
            enabled={requireInviteCode}
            isLoading={isLoading('setRequireInviteCode') || !openRegister}
            ariaLabel='切换邀请码要求'
            onToggle={() =>
              void run('setRequireInviteCode', () =>
                setRequireInviteCode(!requireInviteCode),
              )
            }
          />
        </AdminSettingRow>
        <AdminSettingRow label='有效邀请码' layout='inline'>
          <span className='text-sm tabular-nums text-gray-900 dark:text-gray-100'>
            {activeInviteCodeCount}
            <span className='text-gray-400 dark:text-gray-500'>
              {' '}
              / {MAX_INVITE_CODES}
            </span>
          </span>
          <button
            type='button'
            onClick={openInvite}
            className={`${buttonStyles.outline} inline-flex items-center gap-1.5`}
          >
            <Settings2 className='h-4 w-4' />
            管理
          </button>
        </AdminSettingRow>
      </AdminSettingsGroup>

      <LinuxDoSettingsDialog
        isOpen={linuxDoOpen}
        configured={linuxDoConfigured}
        settings={linuxDo}
        onSave={handleSaveLinuxDo}
        onClose={closeLinuxDo}
      />

      <InviteCodesDialog
        isOpen={inviteOpen}
        inviteFilter={inviteFilter}
        inviteList={{
          ...inviteList,
          expectedCount:
            inviteList.totals[inviteFilter] ??
            (inviteFilter === 'all'
              ? userConfig.inviteCodeCount
              : inviteFilter === 'active'
                ? userConfig.activeInviteCodeCount
                : undefined),
        }}
        isCreatingCode={isLoading('createInviteCode')}
        deletingCode={
          inviteList.items.find((item) =>
            isLoading(`deleteInviteCode_${item.code}`),
          )?.code || null
        }
        isPurgingCodes={isLoading('purgeInactiveInviteCodes')}
        onInviteFilterChange={setInviteFilter}
        onCreateCodes={handleCreateInviteCodes}
        onDeleteCode={(code) => void handleDeleteInviteCode(code)}
        onViewCodeUsers={viewCodeUsers}
        onPurgeInactiveCodes={() => setShowPurgeInviteConfirm(true)}
        onClose={closeInvite}
      />

      <ConfirmModal
        isOpen={showPurgeInviteConfirm}
        title='清理失效邀请码'
        message={`将删除 ${inviteList.inactiveCount} 个已过期或已用尽的邀请码，删除后无法恢复。`}
        onClose={() => setShowPurgeInviteConfirm(false)}
        onConfirm={handlePurgeInactiveInviteCodes}
        confirmText='确认清理'
        danger
      />

      <ConfirmModal
        isOpen={showOpenRegisterConfirm}
        title='确认开放注册'
        message='开启后，未注册用户可以通过已启用的注册通道自行创建账号。'
        onClose={() => setShowOpenRegisterConfirm(false)}
        onConfirm={() => {
          setShowOpenRegisterConfirm(false);
          void updateOpenRegister(true);
        }}
        confirmText='确认开启'
      />
    </div>
  );
}
