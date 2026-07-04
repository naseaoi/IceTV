import { NextRequest, NextResponse } from 'next/server';

import { getOptionalActiveUser } from '@/lib/api-auth';
import { getConfigForRead, getPublicConfig } from '@/lib/config';
import { DEFAULT_RUNTIME_CONFIG } from '@/lib/runtime-config';
import { getStorageType } from '@/lib/storage-type';
import { CURRENT_UPDATE_BRANCH, CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

const PUBLIC_DOUBAN_PROXY_TYPES = new Set([
  'direct',
  'server',
  'cors-proxy-zwei',
  'cmliussss-cdn-tencent',
  'cmliussss-cdn-ali',
  'cors-anywhere',
]);

const PUBLIC_DOUBAN_IMAGE_PROXY_TYPES = new Set([
  'direct',
  'img3',
  'cmliussss-cdn-tencent',
  'cmliussss-cdn-ali',
]);

function getPublicDoubanProxyType(proxyType: string | undefined): string {
  return proxyType && PUBLIC_DOUBAN_PROXY_TYPES.has(proxyType)
    ? proxyType
    : DEFAULT_RUNTIME_CONFIG.DOUBAN_PROXY_TYPE;
}

function getPublicBangumiDataSource(dataSource: string | undefined): string {
  return dataSource === 'direct' || dataSource === 'server'
    ? dataSource
    : DEFAULT_RUNTIME_CONFIG.BANGUMI_DATA_SOURCE;
}

function getPublicDoubanImageProxyType(proxyType: string | undefined): string {
  return proxyType && PUBLIC_DOUBAN_IMAGE_PROXY_TYPES.has(proxyType)
    ? proxyType
    : DEFAULT_RUNTIME_CONFIG.DOUBAN_IMAGE_PROXY_TYPE;
}

export async function GET(request: NextRequest) {
  const activeUser = await getOptionalActiveUser(request);
  const canReadSensitiveConfig = !!activeUser;
  const publicConfig = await getPublicConfig();
  const config = await getConfigForRead();
  const doubanProxyType = canReadSensitiveConfig
    ? config.SiteConfig.DoubanProxyType
    : getPublicDoubanProxyType(config.SiteConfig.DoubanProxyType);
  const bangumiDataSource = canReadSensitiveConfig
    ? config.SiteConfig.BangumiDataSource
    : getPublicBangumiDataSource(publicConfig.BangumiDataSource);
  const doubanImageProxyType = canReadSensitiveConfig
    ? config.SiteConfig.DoubanImageProxyType
    : getPublicDoubanImageProxyType(config.SiteConfig.DoubanImageProxyType);
  const result = {
    SiteName: publicConfig.SiteName,
    SiteIcon: publicConfig.SiteIcon,
    Announcement: publicConfig.Announcement,
    StorageType: getStorageType(),
    Version: CURRENT_VERSION,
    OpenRegister: publicConfig.OpenRegister,
    UpdateRepos: process.env.NEXT_PUBLIC_UPDATE_REPOS || 'naseaoi/IceTV',
    UpdateBranch: CURRENT_UPDATE_BRANCH,
    DoubanProxyType: doubanProxyType,
    DoubanProxy: canReadSensitiveConfig
      ? config.SiteConfig.DoubanProxy || ''
      : '',
    BangumiDataSource: bangumiDataSource,
    BangumiProxy: canReadSensitiveConfig
      ? config.SiteConfig.BangumiProxy || ''
      : DEFAULT_RUNTIME_CONFIG.BANGUMI_PROXY,
    DoubanImageProxyType: doubanImageProxyType,
    DoubanImageProxy: canReadSensitiveConfig
      ? config.SiteConfig.DoubanImageProxy || ''
      : DEFAULT_RUNTIME_CONFIG.DOUBAN_IMAGE_PROXY,
    DisableYellowFilter: publicConfig.DisableYellowFilter,
    EnableLiveEntry: publicConfig.EnableLiveEntry,
    DefaultAggregateSearch: publicConfig.DefaultAggregateSearch,
    EnableOptimization: publicConfig.EnableOptimization,
    AutoSwitchSourceOnTimeout: publicConfig.AutoSwitchSourceOnTimeout,
    LiveDirectConnect: publicConfig.LiveDirectConnect,
    CustomCategories: publicConfig.CustomCategories,
    FluidSearch: publicConfig.FluidSearch,
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
