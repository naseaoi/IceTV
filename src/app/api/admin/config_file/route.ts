import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireOwner } from '@/lib/api-auth';
import { configConflictResponse } from '@/lib/api-config-error';
import { isCatalogFavoriteSource } from '@/lib/catalog-favorites';
import {
  getConfig,
  invalidateConfigCache,
  refineConfig,
  saveConfig,
} from '@/lib/config';
import { CONFIG_SUBSCRIPTION_MAX_BYTES } from '@/lib/config-state';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const guardResult = await requireOwner(request, {
    forbiddenMessage: '权限不足，只有站长可以修改配置文件',
  });
  if (isGuardFailure(guardResult)) return guardResult.response;

  try {
    const { configFile, subscriptionUrl, autoUpdate, lastCheckTime } =
      await request.json();
    if (!configFile || typeof configFile !== 'string') {
      return NextResponse.json(
        { error: '配置文件内容不能为空' },
        { status: 400 },
      );
    }
    if (Buffer.byteLength(configFile, 'utf8') > CONFIG_SUBSCRIPTION_MAX_BYTES) {
      return NextResponse.json(
        { error: '配置文件超过 2MB 上限' },
        { status: 413 },
      );
    }
    if (
      (subscriptionUrl !== undefined &&
        (typeof subscriptionUrl !== 'string' ||
          subscriptionUrl.length > 8192)) ||
      (autoUpdate !== undefined && typeof autoUpdate !== 'boolean') ||
      (lastCheckTime !== undefined &&
        (typeof lastCheckTime !== 'string' || lastCheckTime.length > 255))
    ) {
      return NextResponse.json({ error: '订阅参数格式错误' }, { status: 400 });
    }
    try {
      const parsed = JSON.parse(configFile);
      if (Object.keys(parsed?.api_site ?? {}).some(isCatalogFavoriteSource))
        return NextResponse.json(
          { error: '目录收藏标识不能用于播放源' },
          { status: 400 },
        );
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error();
    } catch {
      return NextResponse.json(
        { error: '配置文件格式错误，请检查 JSON 语法' },
        { status: 400 },
      );
    }

    invalidateConfigCache();
    const adminConfig = await getConfig();
    const subscription = await db.getConfigSubscription();
    const next = {
      ConfigFile: configFile,
      ConfigSubscribtion: {
        URL: subscriptionUrl ?? subscription.ConfigSubscribtion.URL,
        AutoUpdate: autoUpdate ?? subscription.ConfigSubscribtion.AutoUpdate,
        LastCheck: lastCheckTime || '',
      },
    };
    refineConfig(adminConfig, configFile);
    await saveConfig(adminConfig, {
      subscription: { expected: subscription, next },
    });
    return NextResponse.json({ success: true, message: '配置文件更新成功' });
  } catch (error) {
    const conflict = configConflictResponse(error);
    if (conflict) return conflict;
    console.error('更新配置文件失败:', error);
    return NextResponse.json({ error: '更新配置文件失败' }, { status: 500 });
  }
}
