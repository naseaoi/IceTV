import { NextRequest, NextResponse } from 'next/server';

import { getOptionalActiveUser } from '@/lib/api-auth';
import { getConfig, getPublicConfig } from '@/lib/config';
import { DEFAULT_RUNTIME_CONFIG } from '@/lib/runtime-config';
import { getStorageType } from '@/lib/storage-type';
import { CURRENT_UPDATE_BRANCH, CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const activeUser = await getOptionalActiveUser(request);
  const canReadSensitiveConfig = !!activeUser;
  const publicConfig = await getPublicConfig();
  const config = canReadSensitiveConfig ? await getConfig() : null;
  const doubanImageProxyType =
    canReadSensitiveConfig &&
    config!.SiteConfig.DoubanImageProxyType !== 'direct'
      ? config!.SiteConfig.DoubanImageProxyType
      : DEFAULT_RUNTIME_CONFIG.DOUBAN_IMAGE_PROXY_TYPE;
  const result = {
    SiteName: publicConfig.SiteName,
    SiteIcon: publicConfig.SiteIcon,
    Announcement: publicConfig.Announcement,
    StorageType: getStorageType(),
    Version: CURRENT_VERSION,
    OpenRegister: publicConfig.OpenRegister,
    UpdateRepos: process.env.NEXT_PUBLIC_UPDATE_REPOS || 'naseaoi/IceTV',
    UpdateBranch: CURRENT_UPDATE_BRANCH,
    DoubanProxyType: canReadSensitiveConfig
      ? config!.SiteConfig.DoubanProxyType
      : 'direct',
    DoubanProxy: canReadSensitiveConfig
      ? config!.SiteConfig.DoubanProxy || ''
      : '',
    BangumiDataSource: publicConfig.BangumiDataSource,
    BangumiProxy: canReadSensitiveConfig
      ? config!.SiteConfig.BangumiProxy || ''
      : DEFAULT_RUNTIME_CONFIG.BANGUMI_PROXY,
    DoubanImageProxyType: doubanImageProxyType,
    DoubanImageProxy: canReadSensitiveConfig
      ? config!.SiteConfig.DoubanImageProxy || ''
      : DEFAULT_RUNTIME_CONFIG.DOUBAN_IMAGE_PROXY,
    DisableYellowFilter: publicConfig.DisableYellowFilter,
    EnableLiveEntry: publicConfig.EnableLiveEntry,
    CustomCategories: publicConfig.CustomCategories,
    FluidSearch: publicConfig.FluidSearch,
  };
  return NextResponse.json(result, {
    headers: {
      'Cache-Control': canReadSensitiveConfig
        ? 'private, max-age=60, stale-while-revalidate=300'
        : 'public, max-age=60, stale-while-revalidate=300',
    },
  });
}
