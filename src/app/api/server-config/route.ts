import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getStorageType } from '@/lib/storage-type';
import { CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest) {
  const config = await getConfig();
  const result = {
    SiteName: config.SiteConfig.SiteName,
    SiteIcon: config.SiteConfig.SiteIcon || '',
    StorageType: getStorageType(),
    Version: CURRENT_VERSION,
    OpenRegister: !!config.UserConfig.OpenRegister,
    UpdateRepos: process.env.NEXT_PUBLIC_UPDATE_REPOS || 'naseaoi/IceTV',
    UpdateBranch: process.env.NEXT_PUBLIC_UPDATE_BRANCH || 'main',
    DoubanProxyType: config.SiteConfig.DoubanProxyType,
    DoubanProxy: config.SiteConfig.DoubanProxy || '',
    DoubanImageProxyType: config.SiteConfig.DoubanImageProxyType,
    DoubanImageProxy: config.SiteConfig.DoubanImageProxy || '',
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
