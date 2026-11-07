import { randomBytes } from 'crypto';

import {
  readInactiveConfirmation,
  signInactiveConfirmation,
} from '@/features/admin/services/inactiveConfirmation';
import { parseInactiveDays } from '@/features/admin/services/inactiveUsers';
import {
  buildInviteCode,
  CUSTOM_INVITE_CODE_RULE_MESSAGE,
  generateInviteCode,
  INVITE_MAX_USES_RULE_MESSAGE,
  isValidCustomInviteCode,
  MAX_INVITE_BATCH_SIZE,
  MAX_INVITE_CODES,
  MAX_INVITE_VALID_DAYS,
  MIN_INVITE_VALID_DAYS,
  normalizeInviteCode,
  parseInviteMaxUses,
  parseInviteValidDays,
} from '@/features/admin/services/inviteCodes';
import {
  matchingUsernames,
  selectionQuery,
} from '@/features/admin/services/userSelection';
import {
  ConfigConflictError,
  getConfig,
  invalidateConfigCache,
  saveConfig,
} from '@/lib/config';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';
import { validateAccountPassword } from '@/lib/password-policy';
import { assertValidUsername, normalizeUsername } from '@/lib/username';

const ACTIONS = [
  'add',
  'ban',
  'unban',
  'setAdmin',
  'cancelAdmin',
  'changePassword',
  'deleteUser',
  'updateUserApis',
  'userGroup',
  'updateUserGroups',
  'batchUpdateUserGroups',
  'setOpenRegister',
  'previewInactiveUsers',
  'deleteInactiveUsers',
  'setRequireInviteCode',
  'createInviteCode',
  'deleteInviteCode',
] as const;

const TARGETLESS_ACTIONS = [
  'userGroup',
  'batchUpdateUserGroups',
  'setOpenRegister',
  'previewInactiveUsers',
  'deleteInactiveUsers',
  'setRequireInviteCode',
  'createInviteCode',
  'deleteInviteCode',
];

type AdminUserActionResponse = {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
};

type AdminUserActionContext = {
  body: unknown;
  operatorUsername: string;
  operatorRole: 'owner' | 'admin';
};

function actionResponse(
  body: unknown,
  status?: number,
  headers?: Record<string, string>,
): AdminUserActionResponse {
  return { body, status, headers };
}

function toActionResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): AdminUserActionResponse {
  return actionResponse(body, init?.status, init?.headers);
}

export async function handleAdminUserAction(
  context: AdminUserActionContext,
): Promise<AdminUserActionResponse> {
  return runAdminUserAction(context, 0);
}

async function runAdminUserAction(
  { body, operatorUsername, operatorRole }: AdminUserActionContext,
  attempt: number,
): Promise<AdminUserActionResponse> {
  const username = normalizeUsername(operatorUsername);

  try {
    const {
      targetUsername: rawTargetUsername,
      targetPassword,
      action,
    } = body as {
      targetUsername?: string;
      targetPassword?: string;
      action?: (typeof ACTIONS)[number];
    };
    const targetUsername =
      typeof rawTargetUsername === 'string'
        ? normalizeUsername(rawTargetUsername)
        : undefined;

    if (!action || !ACTIONS.includes(action)) {
      return actionResponse({ error: '参数格式错误' }, 400);
    }

    if (!targetUsername && !TARGETLESS_ACTIONS.includes(action)) {
      return actionResponse({ error: '缺少目标用户名' }, 400);
    }

    if (
      action !== 'changePassword' &&
      action !== 'deleteUser' &&
      action !== 'updateUserApis' &&
      action !== 'updateUserGroups' &&
      !TARGETLESS_ACTIONS.includes(action) &&
      username === targetUsername
    ) {
      return actionResponse({ error: '无法对自己进行此操作' }, 400);
    }

    // 写操作必须基于最新配置，否则命中 TTL 缓存会误判用户不存在或撞版本冲突
    invalidateConfigCache();
    const adminConfig = await getConfig();

    let targetEntry: any = null;
    let isTargetAdmin = false;

    if (!TARGETLESS_ACTIONS.includes(action) && targetUsername) {
      targetEntry = await db.getUserAccess(targetUsername);

      if (targetEntry?.role === 'owner' && operatorRole !== 'owner') {
        return toActionResponse(
          { error: '仅站长可操作站长账号' },
          { status: 403 },
        );
      }

      if (
        targetEntry &&
        targetEntry.role === 'owner' &&
        !['changePassword', 'updateUserApis', 'updateUserGroups'].includes(
          action,
        )
      ) {
        return toActionResponse({ error: '无法操作站长' }, { status: 400 });
      }

      isTargetAdmin = targetEntry?.role === 'admin';
    }

    if (
      (action === 'previewInactiveUsers' &&
        (body as { countOnly?: boolean }).countOnly) ||
      (action === 'deleteInactiveUsers' &&
        (body as { confirmation?: unknown }).confirmation)
    ) {
      const inactiveDays = parseInactiveDays(
        (body as { inactiveDays?: unknown }).inactiveDays,
      );
      if (inactiveDays === null)
        return actionResponse({ error: '不活跃天数错误' }, 400);
      let confirmation;
      try {
        confirmation =
          action === 'deleteInactiveUsers'
            ? readInactiveConfirmation(
                (body as { confirmation: unknown }).confirmation,
                username,
                inactiveDays,
              )
            : null;
      } catch (error) {
        return actionResponse({ error: (error as Error).message }, 400);
      }
      const before =
        confirmation?.before ?? Date.now() - inactiveDays * 86_400_000;
      const query = {
        ownerUsername: getOwnerUsername() || '',
        operatorUsername: username,
        inactiveBefore: before,
        sort: 'username' as const,
        limit: 100,
      };
      if (!confirmation) {
        const page = await db.getAdminUserPage({ ...query, limit: 1 });
        return actionResponse({
          count: page.total,
          confirmation: signInactiveConfirmation({
            before,
            count: page.total,
            operator: username,
            days: inactiveDays,
          }),
        });
      }
      const targets = await matchingUsernames(query);
      let deletedCount = 0;
      for (const target of targets) {
        if (await db.deleteUserIfInactive(target, before, username))
          deletedCount += 1;
      }
      invalidateConfigCache();
      return actionResponse({
        ok: true,
        deletedCount,
        skippedCount: Math.max(0, confirmation.count - deletedCount),
      });
    }

    switch (action) {
      case 'add': {
        let cleanTargetUsername: string;
        try {
          cleanTargetUsername = assertValidUsername(targetUsername!);
        } catch (error) {
          return toActionResponse(
            {
              error: error instanceof Error ? error.message : '用户名格式错误',
            },
            { status: 400 },
          );
        }

        const targetExistsInDb = await db.checkUserExist(cleanTargetUsername);
        if (targetEntry || targetExistsInDb) {
          return toActionResponse({ error: '用户已存在' }, { status: 400 });
        }
        if (!targetPassword) {
          return toActionResponse(
            { error: '缺少目标用户密码' },
            { status: 400 },
          );
        }
        const passwordError = validateAccountPassword(targetPassword);
        if (passwordError) {
          return toActionResponse({ error: passwordError }, { status: 400 });
        }
        await db.registerUser(cleanTargetUsername, targetPassword);

        const { userGroup } = body as { userGroup?: string };

        const newUser: any = {
          username: cleanTargetUsername,
          role: 'user',
        };

        if (userGroup && userGroup.trim()) {
          newUser.tags = [userGroup];
        }

        await db.updateUserAccess([cleanTargetUsername], newUser);
        return actionResponse({ ok: true });
      }
      case 'ban': {
        if (!targetEntry) {
          return toActionResponse({ error: '目标用户不存在' }, { status: 404 });
        }
        if (isTargetAdmin) {
          if (operatorRole !== 'owner') {
            return toActionResponse(
              { error: '仅站长可封禁管理员' },
              { status: 403 },
            );
          }
        }
        targetEntry.banned = true;
        break;
      }
      case 'unban': {
        if (!targetEntry) {
          return toActionResponse({ error: '目标用户不存在' }, { status: 404 });
        }
        if (isTargetAdmin) {
          if (operatorRole !== 'owner') {
            return toActionResponse(
              { error: '仅站长可操作管理员' },
              { status: 403 },
            );
          }
        }
        targetEntry.banned = false;
        break;
      }
      case 'setAdmin': {
        if (!targetEntry) {
          return toActionResponse({ error: '目标用户不存在' }, { status: 404 });
        }
        if (targetEntry.role === 'admin') {
          return toActionResponse(
            { error: '该用户已是管理员' },
            { status: 400 },
          );
        }
        if (operatorRole !== 'owner') {
          return toActionResponse(
            { error: '仅站长可设置管理员' },
            { status: 403 },
          );
        }
        targetEntry.role = 'admin';
        break;
      }
      case 'cancelAdmin': {
        if (!targetEntry) {
          return toActionResponse({ error: '目标用户不存在' }, { status: 404 });
        }
        if (targetEntry.role !== 'admin') {
          return toActionResponse(
            { error: '目标用户不是管理员' },
            { status: 400 },
          );
        }
        if (operatorRole !== 'owner') {
          return toActionResponse(
            { error: '仅站长可取消管理员' },
            { status: 403 },
          );
        }
        targetEntry.role = 'user';
        break;
      }
      case 'changePassword': {
        if (!targetEntry) {
          return toActionResponse({ error: '目标用户不存在' }, { status: 404 });
        }
        if (!targetPassword) {
          return toActionResponse({ error: '缺少新密码' }, { status: 400 });
        }
        const passwordError = validateAccountPassword(targetPassword);
        if (passwordError) {
          return toActionResponse({ error: passwordError }, { status: 400 });
        }

        if (targetEntry.role === 'owner') {
          return toActionResponse(
            { error: '无法修改站长密码' },
            { status: 403 },
          );
        }

        if (
          isTargetAdmin &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return toActionResponse(
            { error: '仅站长可修改其他管理员密码' },
            { status: 403 },
          );
        }

        await db.changePassword(targetUsername!, targetPassword);
        return actionResponse({ ok: true });
      }
      case 'deleteUser': {
        if (!targetEntry) {
          return toActionResponse({ error: '目标用户不存在' }, { status: 404 });
        }

        if (username === targetUsername) {
          return toActionResponse({ error: '不能删除自己' }, { status: 400 });
        }

        if (isTargetAdmin && operatorRole !== 'owner') {
          return toActionResponse(
            { error: '仅站长可删除管理员' },
            { status: 403 },
          );
        }

        await db.deleteUser(targetUsername!, {
          operatorUsername: username,
          operatorRole,
          excludeSelf: true,
        });

        return actionResponse({ ok: true });
      }
      case 'updateUserApis': {
        if (!targetEntry) {
          return toActionResponse({ error: '目标用户不存在' }, { status: 404 });
        }

        const { enabledApis } = body as { enabledApis?: string[] };

        if (
          isTargetAdmin &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return toActionResponse(
            { error: '仅站长可配置其他管理员的视频源权限' },
            { status: 403 },
          );
        }

        if (enabledApis && enabledApis.length > 0) {
          targetEntry.enabledApis = enabledApis;
        } else {
          delete targetEntry.enabledApis;
        }

        break;
      }
      case 'userGroup': {
        const { groupAction, groupName, enabledApis, allowLive } = body as {
          groupAction: 'add' | 'edit' | 'delete';
          groupName: string;
          enabledApis?: string[];
          allowLive?: boolean;
        };

        if (!adminConfig.UserConfig.Tags) {
          adminConfig.UserConfig.Tags = [];
        }

        switch (groupAction) {
          case 'add': {
            if (adminConfig.UserConfig.Tags.find((t) => t.name === groupName)) {
              return toActionResponse(
                { error: '用户组已存在' },
                { status: 400 },
              );
            }
            adminConfig.UserConfig.Tags.push({
              name: groupName,
              enabledApis: enabledApis || [],
              ...(allowLive === true ? { allowLive: true } : {}),
            });
            break;
          }
          case 'edit': {
            const groupIndex = adminConfig.UserConfig.Tags.findIndex(
              (t) => t.name === groupName,
            );
            if (groupIndex === -1) {
              return toActionResponse(
                { error: '用户组不存在' },
                { status: 404 },
              );
            }
            const group = adminConfig.UserConfig.Tags[groupIndex];
            group.enabledApis = enabledApis || [];
            if (allowLive === true) group.allowLive = true;
            else delete group.allowLive;
            break;
          }
          case 'delete': {
            const groupIndex = adminConfig.UserConfig.Tags.findIndex(
              (t) => t.name === groupName,
            );
            if (groupIndex === -1) {
              return toActionResponse(
                { error: '用户组不存在' },
                { status: 404 },
              );
            }

            adminConfig.UserConfig.Tags.splice(groupIndex, 1);

            break;
          }
          default:
            return toActionResponse(
              { error: '未知的用户组操作' },
              { status: 400 },
            );
        }
        break;
      }
      case 'updateUserGroups': {
        if (!targetEntry) {
          return toActionResponse({ error: '目标用户不存在' }, { status: 404 });
        }

        const { userGroups } = body as { userGroups: string[] };

        if (
          isTargetAdmin &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return toActionResponse(
            { error: '仅站长可配置其他管理员的用户组' },
            { status: 403 },
          );
        }

        if (userGroups && userGroups.length > 0) {
          targetEntry.tags = userGroups;
        } else {
          delete targetEntry.tags;
        }

        break;
      }
      case 'batchUpdateUserGroups': {
        const { selection, usernames, userGroups, dryRun } = body as {
          selection?: unknown;
          usernames?: unknown;
          userGroups?: unknown;
          dryRun?: boolean;
        };
        if (
          !selection &&
          Array.isArray(usernames) &&
          operatorRole !== 'owner'
        ) {
          for (const raw of usernames) {
            if (typeof raw !== 'string')
              return actionResponse({ error: '用户名列表格式错误' }, 400);
            const target = await db.getUserAccess(normalizeUsername(raw));
            if (target?.role === 'owner')
              return actionResponse(
                { error: `管理员无法操作站长 ${target.username}` },
                403,
              );
            if (target?.role === 'admin' && target.username !== username)
              return actionResponse(
                { error: `管理员无法操作其他管理员 ${target.username}` },
                403,
              );
          }
        }
        if (
          !Array.isArray(userGroups) ||
          userGroups.some(
            (group) =>
              typeof group !== 'string' ||
              !adminConfig.UserConfig.Tags?.some((tag) => tag.name === group),
          )
        ) {
          return actionResponse({ error: '用户组不存在' }, 400);
        }
        let query;
        try {
          query = selectionQuery(
            selection || { mode: 'explicit', usernames },
            username,
          );
        } catch (error) {
          return actionResponse({ error: (error as Error).message }, 400);
        }
        const targets = await matchingUsernames(query);
        const entries = await Promise.all(
          targets.map((target) => db.getUserAccess(target)),
        );
        const eligible = entries.filter(
          (user) =>
            user &&
            user.username !== username &&
            user.role !== 'owner' &&
            (operatorRole === 'owner' || user.role !== 'admin'),
        );
        const skippedCount = targets.length - eligible.length;
        if (dryRun)
          return actionResponse({
            affectedCount: eligible.length,
            skippedCount,
          });
        const processedCount = await db.updateUserAccess(
          eligible.map((user) => user!.username),
          { tags: userGroups as string[] },
          { operatorUsername: username, operatorRole, excludeSelf: true },
        );
        return actionResponse({
          ok: true,
          processedCount,
          skippedCount: targets.length - processedCount,
        });
      }
      case 'previewInactiveUsers':
      case 'deleteInactiveUsers':
        return actionResponse({ error: '页面已更新，请刷新后重试' }, 400);
      case 'setOpenRegister': {
        const { openRegister } = body as { openRegister?: boolean };
        if (typeof openRegister !== 'boolean') {
          return toActionResponse(
            { error: '开放注册参数错误' },
            { status: 400 },
          );
        }
        adminConfig.UserConfig.OpenRegister = openRegister;
        break;
      }
      case 'setRequireInviteCode': {
        const { requireInviteCode } = body as { requireInviteCode?: boolean };
        if (typeof requireInviteCode !== 'boolean') {
          return toActionResponse(
            { error: '邀请码开关参数错误' },
            { status: 400 },
          );
        }
        adminConfig.UserConfig.RequireInviteCode = requireInviteCode;
        break;
      }
      case 'createInviteCode': {
        const { count = 1 } = body as { count?: unknown };
        if (
          typeof count !== 'number' ||
          !Number.isInteger(count) ||
          count < 1 ||
          count > MAX_INVITE_BATCH_SIZE
        ) {
          return actionResponse(
            { error: `生成数量需在 1-${MAX_INVITE_BATCH_SIZE} 之间` },
            400,
          );
        }
        const validDays = parseInviteValidDays(
          (body as { validDays?: unknown }).validDays,
        );
        if (validDays === null) {
          return toActionResponse(
            {
              error: `有效天数需在 ${MIN_INVITE_VALID_DAYS}-${MAX_INVITE_VALID_DAYS} 之间`,
            },
            { status: 400 },
          );
        }

        const maxUses = parseInviteMaxUses(
          (body as { maxUses?: unknown }).maxUses,
        );
        if (maxUses === null) {
          return toActionResponse(
            { error: INVITE_MAX_USES_RULE_MESSAGE },
            { status: 400 },
          );
        }

        const rawCustomCode = (body as { code?: unknown }).code;
        const hasCustomCode =
          typeof rawCustomCode === 'string' && rawCustomCode.trim() !== '';
        if (hasCustomCode && count > 1) {
          return actionResponse({ error: '自定义邀请码只能单个生成' }, 400);
        }
        if (hasCustomCode && !isValidCustomInviteCode(rawCustomCode)) {
          return actionResponse(
            { error: CUSTOM_INVITE_CODE_RULE_MESSAGE },
            400,
          );
        }
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const codes: string[] = Array.from({ length: count }, () =>
            hasCustomCode
              ? normalizeInviteCode(rawCustomCode)
              : generateInviteCode((size) => randomBytes(size)),
          );
          if (new Set(codes).size !== count) continue;
          const now = Date.now();
          const result = await db.createInviteCodes(
            codes.map((code) =>
              buildInviteCode({
                code,
                validDays,
                createdBy: username,
                maxUses,
                now,
              }),
            ),
          );
          if (result === 'created')
            return actionResponse(
              { ok: true, code: codes[0], codes },
              undefined,
              {
                'Cache-Control': 'no-store',
              },
            );
          if (result === 'limit')
            return actionResponse(
              { error: `有效邀请码不能超过 ${MAX_INVITE_CODES} 个` },
              400,
            );
          if (hasCustomCode)
            return actionResponse({ error: '该邀请码已存在' }, 409);
        }
        return actionResponse({ error: '生成邀请码失败，请重试' }, 500);
      }
      case 'deleteInviteCode': {
        const code = normalizeInviteCode((body as { code?: unknown }).code);
        if (!code) {
          return toActionResponse({ error: '缺少邀请码' }, { status: 400 });
        }

        if (!(await db.deleteInviteCode(code))) {
          return toActionResponse({ error: '邀请码不存在' }, { status: 404 });
        }
        return actionResponse({ ok: true }, undefined, {
          'Cache-Control': 'no-store',
        });
      }
      default:
        return toActionResponse({ error: '未知操作' }, { status: 400 });
    }

    if (
      targetEntry &&
      [
        'ban',
        'unban',
        'setAdmin',
        'cancelAdmin',
        'updateUserApis',
        'updateUserGroups',
      ].includes(action)
    ) {
      const patch =
        action === 'ban' || action === 'unban'
          ? { banned: targetEntry.banned }
          : action === 'setAdmin' || action === 'cancelAdmin'
            ? { role: targetEntry.role }
            : action === 'updateUserApis'
              ? { enabledApis: targetEntry.enabledApis }
              : { tags: targetEntry.tags };
      const updated = await db.updateUserAccess([targetUsername!], patch, {
        operatorUsername: username,
        operatorRole,
      });
      if (!updated)
        return actionResponse({ error: '用户权限已变化，请刷新后重试' }, 409);
    } else {
      await saveConfig(adminConfig);
    }

    return toActionResponse(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    if (error instanceof ConfigConflictError) {
      const action = (body as { action?: string })?.action;
      const retryable = [
        'ban',
        'unban',
        'setAdmin',
        'cancelAdmin',
        'updateUserApis',
        'updateUserGroups',
        'batchUpdateUserGroups',
        'userGroup',
        'setOpenRegister',
        'setRequireInviteCode',
      ];
      if (attempt < 2 && action && retryable.includes(action)) {
        return runAdminUserAction(
          { body, operatorUsername, operatorRole },
          attempt + 1,
        );
      }
      return toActionResponse({ error: error.message }, { status: 409 });
    }
    console.error('用户管理操作失败:', error);
    return toActionResponse(
      {
        error: '用户管理操作失败',
      },
      { status: 500 },
    );
  }
}
