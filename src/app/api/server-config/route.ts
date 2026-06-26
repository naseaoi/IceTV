import { NextRequest, NextResponse } from 'next/server';

import { getOptionalActiveUser } from '@/lib/api-auth';
import { getConfig } from '@/lib/config';
import { getStorageType } from '@/lib/storage-type';
import { CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const config = await getConfig();
  const activeUser = await getOptionalActiveUser(request);
  const canReadSensitiveConfig = !!activeUser;
  const result = {
    SiteName: config.SiteConfig.SiteName,
    SiteIcon: config.SiteConfig.SiteIcon || '',
    StorageType: getStorageType(),
    Version: CURRENT_VERSION,
    OpenRegister: !!config.UserConfig.OpenRegister,
    UpdateRepos: process.env.NEXT_PUBLIC_UPDATE_REPOS || 'naseaoi/IceTV',
    UpdateBranch: process.env.NEXT_PUBLIC_UPDATE_BRANCH || 'main',
    DoubanProxyType: canReadSensitiveConfig
      ? config.SiteConfig.DoubanProxyType
      : 'direct',
    DoubanProxy: canReadSensitiveConfig
      ? config.SiteConfig.DoubanProxy || ''
      : '',
    DoubanImageProxyType: canReadSensitiveConfig
      ? config.SiteConfig.DoubanImageProxyType
      : 'direct',
    DoubanImageProxy: canReadSensitiveConfig
      ? config.SiteConfig.DoubanImageProxy || ''
      : '',
    DisableYellowFilter: config.SiteConfig.DisableYellowFilter,
    EnableLiveEntry: config.SiteConfig.EnableLiveEntry,
    CustomCategories: config.CustomCategories.filter(
      (category) => !category.disabled,
    ).map((category) => ({
      name: category.name || '',
      type: category.type,
      query: category.query,
    })),
    FluidSearch: config.SiteConfig.FluidSearch,
  };
  return NextResponse.json(result);
}
