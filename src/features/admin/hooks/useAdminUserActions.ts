'use client';

import { useCallback } from 'react';

import { adminPost } from '@/features/admin/lib/api';
import { showError } from '@/features/admin/lib/notifications';
import { type InactiveCandidate } from '@/features/admin/services/inactiveUsers';
import { type ShowAlertFn } from '@/hooks/useAlertModal';

type UserAction =
  | 'add'
  | 'ban'
  | 'unban'
  | 'setAdmin'
  | 'cancelAdmin'
  | 'changePassword'
  | 'deleteUser'
  | 'setOpenRegister';

interface UseAdminUserActionsOptions {
  refreshConfig: () => Promise<void>;
  showAlert: ShowAlertFn;
}

export function useAdminUserActions(options: UseAdminUserActionsOptions) {
  const { refreshConfig, showAlert } = options;

  const runUserMutation = useCallback(
    async (payload: Record<string, unknown>, fallbackPrefix = '操作失败') => {
      try {
        await adminPost('/api/admin/user', payload, fallbackPrefix);
        await refreshConfig();
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
      enabledApis?: string[],
    ) => {
      await runUserMutation({
        action: 'userGroup',
        groupAction: action,
        groupName,
        enabledApis,
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
    async (inactiveDays: number, includeNeverActive: boolean) => {
      try {
        const data = await adminPost<{ candidates: InactiveCandidate[] }>(
          '/api/admin/user',
          { action: 'previewInactiveUsers', inactiveDays, includeNeverActive },
          '筛选不活跃用户失败',
        );
        return data.candidates || [];
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
    async (
      inactiveDays: number,
      usernames: string[],
      includeNeverActive: boolean,
    ) => {
      try {
        const data = await adminPost<{
          deletedCount: number;
          skippedCount: number;
        }>(
          '/api/admin/user',
          {
            action: 'deleteInactiveUsers',
            inactiveDays,
            usernames,
            includeNeverActive,
          },
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

  const createInviteCode = useCallback(
    async (validDays: number, customCode?: string, maxUses?: number) => {
      const code = customCode?.trim();
      await runUserMutation(
        {
          action: 'createInviteCode',
          validDays,
          ...(code ? { code } : {}),
          ...(maxUses ? { maxUses } : {}),
        },
        '生成邀请码失败',
      );
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

  const setRequireInviteCode = useCallback(
    async (requireInviteCode: boolean) => {
      await runUserMutation(
        { action: 'setRequireInviteCode', requireInviteCode },
        '设置邀请码要求失败',
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
    createInviteCode,
    deleteInviteCode,
    setRequireInviteCode,
    updateUserApis,
    userAction,
  };
}
