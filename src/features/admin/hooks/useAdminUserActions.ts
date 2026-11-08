'use client';

import { useCallback } from 'react';

import { adminPost } from '@/features/admin/lib/api';
import { showError } from '@/features/admin/lib/notifications';
import { type ShowAlertFn } from '@/hooks/useAlertModal';
import type { LinuxDoLoginSettings } from '@/types/admin';

type UserAction =
  | 'add'
  | 'ban'
  | 'unban'
  | 'setAdmin'
  | 'cancelAdmin'
  | 'changePassword'
  | 'deleteUser'
  | 'setOpenRegister';

export interface InviteCodeDraft {
  count: number;
  validDays: number;
  maxUses?: number;
  customCode?: string;
}

interface UseAdminUserActionsOptions {
  refreshConfig: () => Promise<void>;
  showAlert: ShowAlertFn;
}

export function useAdminUserActions(options: UseAdminUserActionsOptions) {
  const { refreshConfig, showAlert } = options;

  const runUserMutation = useCallback(
    async <T = Record<string, unknown>>(
      payload: Record<string, unknown>,
      fallbackPrefix = '操作失败',
    ): Promise<T> => {
      try {
        const data = await adminPost<T>(
          '/api/admin/user',
          payload,
          fallbackPrefix,
        );
        await refreshConfig();
        return data;
      } catch (err) {
        showError(
          err instanceof Error ? err.message : fallbackPrefix,
          showAlert,
        );
        throw err;
      }
    },
    [refreshConfig, showAlert],
  );

  const userGroupAction = useCallback(
    async (
      action: 'add' | 'edit' | 'delete',
      groupName: string,
      permissions?: { enabledApis: string[]; allowLive?: boolean },
    ) => {
      await runUserMutation({
        action: 'userGroup',
        groupAction: action,
        groupName,
        enabledApis: permissions?.enabledApis,
        allowLive: permissions?.allowLive === true,
      });
    },
    [runUserMutation],
  );

  const assignUserGroups = useCallback(
    async (username: string, userGroups: string[]) => {
      await runUserMutation({
        targetUsername: username,
        action: 'updateUserGroups',
        userGroups,
      });
    },
    [runUserMutation],
  );

  const batchUpdateUserGroups = useCallback(
    async (usernames: string[], userGroup: string) => {
      await runUserMutation({
        action: 'batchUpdateUserGroups',
        usernames,
        userGroups: userGroup === '' ? [] : [userGroup],
      });
    },
    [runUserMutation],
  );

  const previewInactiveUsers = useCallback(
    async (inactiveDays: number) => {
      try {
        const data = await adminPost<{ count: number; confirmation: string }>(
          '/api/admin/user',
          { action: 'previewInactiveUsers', inactiveDays, countOnly: true },
          '筛选不活跃用户失败',
        );
        return data;
      } catch (err) {
        showError(
          err instanceof Error ? err.message : '筛选不活跃用户失败',
          showAlert,
        );
        throw err;
      }
    },
    [showAlert],
  );

  const deleteInactiveUsers = useCallback(
    async (inactiveDays: number, confirmation: string) => {
      try {
        const data = await adminPost<{
          deletedCount: number;
          skippedCount: number;
        }>(
          '/api/admin/user',
          { action: 'deleteInactiveUsers', inactiveDays, confirmation },
          '清理不活跃用户失败',
        );
        await refreshConfig();
        return data;
      } catch (err) {
        showError(
          err instanceof Error ? err.message : '清理不活跃用户失败',
          showAlert,
        );
        throw err;
      }
    },
    [refreshConfig, showAlert],
  );

  const createInviteCodes = useCallback(
    async ({ count, validDays, maxUses, customCode }: InviteCodeDraft) => {
      const code = customCode?.trim();
      const data = await runUserMutation<{ code?: string; codes?: string[] }>(
        {
          action: 'createInviteCode',
          validDays,
          ...(code ? { code } : {}),
          ...(maxUses ? { maxUses } : {}),
          ...(count > 1 ? { count } : {}),
        },
        '生成邀请码失败',
      );
      return data.codes ?? (data.code ? [data.code] : []);
    },
    [runUserMutation],
  );

  const deleteInviteCode = useCallback(
    async (code: string) => {
      await runUserMutation(
        { action: 'deleteInviteCode', code },
        '删除邀请码失败',
      );
    },
    [runUserMutation],
  );

  const purgeInactiveInviteCodes = useCallback(async () => {
    const data = await runUserMutation<{ deleted?: number }>(
      { action: 'purgeInactiveInviteCodes' },
      '清理失效邀请码失败',
    );
    return data.deleted ?? 0;
  }, [runUserMutation]);

  const setRequireInviteCode = useCallback(
    async (requireInviteCode: boolean) => {
      await runUserMutation(
        { action: 'setRequireInviteCode', requireInviteCode },
        '设置邀请码要求失败',
      );
    },
    [runUserMutation],
  );

  const setLinuxDo = useCallback(
    async (linuxDo: LinuxDoLoginSettings) => {
      await runUserMutation(
        { action: 'setLinuxDo', linuxDo },
        '设置 LinuxDo 登录失败',
      );
    },
    [runUserMutation],
  );

  const setDefaultUserGroup = useCallback(
    async (userGroup: string) => {
      await runUserMutation(
        { action: 'setDefaultUserGroup', userGroup },
        '设置默认用户组失败',
      );
    },
    [runUserMutation],
  );

  const updateUserApis = useCallback(
    async (username: string, enabledApis: string[]) => {
      await runUserMutation({
        targetUsername: username,
        action: 'updateUserApis',
        enabledApis,
      });
    },
    [runUserMutation],
  );

  const userAction = useCallback(
    async (
      action: UserAction,
      targetUsername?: string,
      targetPassword?: string,
      userGroup?: string,
      openRegister?: boolean,
    ) => {
      await runUserMutation({
        ...(targetUsername ? { targetUsername } : {}),
        ...(targetPassword ? { targetPassword } : {}),
        ...(userGroup ? { userGroup } : {}),
        ...(typeof openRegister === 'boolean' ? { openRegister } : {}),
        action,
      });
    },
    [runUserMutation],
  );

  return {
    userGroupAction,
    assignUserGroups,
    batchUpdateUserGroups,
    previewInactiveUsers,
    deleteInactiveUsers,
    createInviteCodes,
    deleteInviteCode,
    purgeInactiveInviteCodes,
    setRequireInviteCode,
    setLinuxDo,
    setDefaultUserGroup,
    updateUserApis,
    userAction,
  };
}
