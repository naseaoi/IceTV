import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { configConflictResponse } from '@/lib/api-config-error';
import { getConfig, saveConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireAdmin(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const body = await request.json();

    const {
      SiteName,
      SiteIcon,
      Announcement,
      EnableLiveEntry,
      DefaultAggregateSearch,
      EnableOptimization,
      AutoSwitchSourceOnTimeout,
      LiveDirectConnect,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      DoubanProxyType,
      DoubanProxy,
      BangumiDataSource,
      BangumiProxy,
      DoubanImageProxyType,
      DoubanImageProxy,
      DisableYellowFilter,
      FluidSearch,
    } = body as {
      SiteName: string;
      SiteIcon: string;
      Announcement: string;
      EnableLiveEntry: boolean;
      DefaultAggregateSearch: boolean;
      EnableOptimization: boolean;
      AutoSwitchSourceOnTimeout: boolean;
      LiveDirectConnect: boolean;
      SearchDownstreamMaxPage: number;
      SiteInterfaceCacheTime: number;
      DoubanProxyType: string;
      DoubanProxy: string;
      BangumiDataSource?: string;
      BangumiProxy?: string;
      DoubanImageProxyType: string;
      DoubanImageProxy: string;
      DisableYellowFilter: boolean;
      FluidSearch: boolean;
    };

    // 参数校验
    if (
      typeof SiteName !== 'string' ||
      typeof Announcement !== 'string' ||
      typeof EnableLiveEntry !== 'boolean' ||
      typeof DefaultAggregateSearch !== 'boolean' ||
      typeof EnableOptimization !== 'boolean' ||
      typeof AutoSwitchSourceOnTimeout !== 'boolean' ||
      typeof LiveDirectConnect !== 'boolean' ||
      typeof SearchDownstreamMaxPage !== 'number' ||
      typeof SiteInterfaceCacheTime !== 'number' ||
      typeof DoubanProxyType !== 'string' ||
      typeof DoubanProxy !== 'string' ||
      (BangumiDataSource !== undefined &&
        typeof BangumiDataSource !== 'string') ||
      (BangumiProxy !== undefined && typeof BangumiProxy !== 'string') ||
      typeof DoubanImageProxyType !== 'string' ||
      typeof DoubanImageProxy !== 'string' ||
      typeof DisableYellowFilter !== 'boolean' ||
      typeof FluidSearch !== 'boolean'
    ) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    const adminConfig = await getConfig();

    // 更新缓存中的站点设置
    adminConfig.SiteConfig = {
      SiteName,
      SiteIcon:
        typeof SiteIcon === 'string'
          ? SiteIcon
          : adminConfig.SiteConfig.SiteIcon || '',
      Announcement,
      EnableLiveEntry,
      DefaultAggregateSearch,
      EnableOptimization,
      AutoSwitchSourceOnTimeout,
      LiveDirectConnect,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      DoubanProxyType,
      DoubanProxy,
      BangumiDataSource:
        BangumiDataSource || adminConfig.SiteConfig.BangumiDataSource,
      BangumiProxy:
        BangumiProxy !== undefined
          ? BangumiProxy
          : adminConfig.SiteConfig.BangumiProxy || '',
      DoubanImageProxyType,
      DoubanImageProxy,
      DisableYellowFilter,
      FluidSearch,
    };

    // 写入数据库
    await saveConfig(adminConfig);

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 不缓存结果
        },
      },
    );
  } catch (error) {
    const conflict = configConflictResponse(error);
    if (conflict) return conflict;
    console.error('更新站点配置失败:', error);
    return NextResponse.json({ error: '更新站点配置失败' }, { status: 500 });
  }
}
