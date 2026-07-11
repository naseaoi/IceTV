import { NextRequest, NextResponse } from 'next/server';

import { getOptionalActiveUser } from '@/lib/api-auth';
import { normalizeSiteBangumiDataSource } from '@/lib/bangumi-source';
import { getConfigForRead, getPublicConfig } from '@/lib/config';
import {
  normalizeSiteDoubanImageProxyType,
  normalizeSiteDoubanProxyType,
} from '@/lib/douban-options';
import { DEFAULT_RUNTIME_CONFIG } from '@/lib/runtime-config';
import { getStorageType } from '@/lib/storage-type';
import { CURRENT_UPDATE_BRANCH, CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const activeUser = await getOptionalActiveUser(request);
  const canReadSensitiveConfig = !!activeUser;
  const publicConfig = await getPublicConfig();
  const config = await getConfigForRead();
  const doubanProxyType = canReadSensitiveConfig
    ? normalizeSiteDoubanProxyType(config.SiteConfig.DoubanProxyType)
    : publicConfig.DoubanProxyType;
  const bangumiDataSource = canReadSensitiveConfig
    ? normalizeSiteBangumiDataSource(config.SiteConfig.BangumiDataSource)
    : publicConfig.BangumiDataSource;
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
    OpenRegister: publicConfig.OpenRegister,
    UpdateRepos: process.env.NEXT_PUBLIC_UPDATE_REPOS || 'naseaoi/IceTV',
    UpdateBranch: CURRENT_UPDATE_BRANCH,
    DoubanProxyType: doubanProxyType,
    DoubanProxy: DEFAULT_RUNTIME_CONFIG.DOUBAN_PROXY,
    BangumiDataSource: bangumiDataSource,
    BangumiProxy: DEFAULT_RUNTIME_CONFIG.BANGUMI_PROXY,
    DoubanImageProxyType: doubanImageProxyType,
    DoubanImageProxy: DEFAULT_RUNTIME_CONFIG.DOUBAN_IMAGE_PROXY,
    DisableYellowFilter: publicConfig.DisableYellowFilter,
    EnableLiveEntry: publicConfig.EnableLiveEntry,
    DefaultAggregateSearch: publicConfig.DefaultAggregateSearch,
    EnableOptimization: publicConfig.EnableOptimization,
    LiveDirectConnect: publicConfig.LiveDirectConnect,
    CustomCategories: publicConfig.CustomCategories,
    FluidSearch: publicConfig.FluidSearch,
    VodPageTimeoutSeconds: publicConfig.VodPageTimeoutSeconds,
    PlaybackHistoryPageSize: publicConfig.PlaybackHistoryPageSize,
    PlaybackHistoryLimit: publicConfig.PlaybackHistoryLimit,
    SearchHistoryLimit: publicConfig.SearchHistoryLimit,
    SourceFailureCooldownSeconds: publicConfig.SourceFailureCooldownSeconds,
    ContinueWatchingLimit: publicConfig.ContinueWatchingLimit,
    CoverImageCacheSize: publicConfig.CoverImageCacheSize,
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
