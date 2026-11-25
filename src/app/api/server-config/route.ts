import { NextRequest, NextResponse } from 'next/server';

import { getOptionalActiveUser } from '@/lib/api-auth';
import {
  getConfigForRead,
  getConfigFresh,
  getPublicConfig,
} from '@/lib/config';
import {
  normalizeSiteDoubanImageProxyType,
  normalizeSiteDoubanProxyType,
} from '@/lib/douban-options';
import { canUserWatchLive } from '@/lib/live-access.server';
import { DEFAULT_RUNTIME_CONFIG } from '@/lib/runtime-config';
import { getStorageType } from '@/lib/storage-type';
import { CURRENT_UPDATE_BRANCH, CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const activeUser = await getOptionalActiveUser(request);
  const canReadSensitiveConfig = !!activeUser;
  // 普通读取走 TTL 缓存；管理员保存后的刷新带 fresh=1，跳过其他实例或执行路径中的旧快照。
  const readFresh =
    request.nextUrl.searchParams.get('fresh') === '1' &&
    (activeUser?.role === 'admin' || activeUser?.role === 'owner');
  const config = readFresh ? await getConfigFresh() : await getConfigForRead();
  const publicConfig = await getPublicConfig();
  const doubanProxyType = canReadSensitiveConfig
    ? normalizeSiteDoubanProxyType(config.SiteConfig.DoubanProxyType)
    : publicConfig.DoubanProxyType;
  const doubanImageProxyType = canReadSensitiveConfig
    ? normalizeSiteDoubanImageProxyType(config.SiteConfig.DoubanImageProxyType)
    : publicConfig.DoubanImageProxyType;
  const result = {
    SiteName: publicConfig.SiteName,
    SiteIcon: publicConfig.SiteIcon,
    Announcement: publicConfig.Announcement,
    FooterText: publicConfig.FooterText,
    StorageType: getStorageType(),
    Version: CURRENT_VERSION,
    PasswordRegister: publicConfig.PasswordRegister,
    LinuxDoLogin: publicConfig.LinuxDoLogin,
    RequireInviteCode: publicConfig.RequireInviteCode,
    UpdateRepos: process.env.NEXT_PUBLIC_UPDATE_REPOS || 'naseaoi/IceTV',
    UpdateBranch: CURRENT_UPDATE_BRANCH,
    DoubanProxyType: doubanProxyType,
    DoubanProxy: DEFAULT_RUNTIME_CONFIG.DOUBAN_PROXY,
    DoubanImageProxyType: doubanImageProxyType,
    DoubanImageProxy: DEFAULT_RUNTIME_CONFIG.DOUBAN_IMAGE_PROXY,
    EnableLiveEntry: await canUserWatchLive(activeUser?.username, config),
    DefaultAggregateSearch: publicConfig.DefaultAggregateSearch,
    EnableOptimization: publicConfig.EnableOptimization,
    AutoSwitchSource: publicConfig.AutoSwitchSource,
    EnableDanmaku: publicConfig.EnableDanmaku,
    EnableUserDanmaku: publicConfig.EnableUserDanmaku,
    CustomCategories: publicConfig.CustomCategories,
    FluidSearch: publicConfig.FluidSearch,
    VodPageTimeoutSeconds: publicConfig.VodPageTimeoutSeconds,
    VodFragmentTimeoutSeconds: publicConfig.VodFragmentTimeoutSeconds,
    ImageProxyTimeoutSeconds: publicConfig.ImageProxyTimeoutSeconds,
    SourceCoverProxyMode: publicConfig.SourceCoverProxyMode,
  };
  return NextResponse.json(result, {
    headers: {
      'Cache-Control': canReadSensitiveConfig
        ? 'private, max-age=60, stale-while-revalidate=300'
        : 'public, max-age=60, stale-while-revalidate=300',
      Vary: 'Cookie',
    },
  });
}
