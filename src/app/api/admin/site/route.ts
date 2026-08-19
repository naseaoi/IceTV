import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { configConflictResponse } from '@/lib/api-config-error';
import { normalizeSiteBangumiDataSource } from '@/lib/bangumi-source';
import { getConfig, saveConfig } from '@/lib/config';
import {
  normalizeSiteDoubanImageProxyType,
  normalizeSiteDoubanProxyType,
} from '@/lib/douban-options';
import {
  commitStagedSiteIcon,
  hasStagedSiteIcon,
  removeSiteIcon,
} from '@/lib/site-icon-storage.server';
import { normalizeSourceCoverProxyMode } from '@/lib/source-cover-proxy';

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
      FooterText,
      EnableLiveEntry,
      DefaultAggregateSearch,
      EnableOptimization,
      LiveDirectConnect,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      DoubanProxyType,
      BangumiDataSource,
      DoubanImageProxyType,
      SourceCoverProxyMode,
      DisableYellowFilter,
      FluidSearch,
      SiteIconStagingToken,
      RemoveSiteIcon,
    } = body as {
      SiteName: string;
      SiteIcon: string;
      Announcement: string;
      FooterText: string;
      EnableLiveEntry: boolean;
      DefaultAggregateSearch: boolean;
      EnableOptimization: boolean;
      LiveDirectConnect: boolean;
      SearchDownstreamMaxPage: number;
      SiteInterfaceCacheTime: number;
      DoubanProxyType: string;
      BangumiDataSource?: string;
      DoubanImageProxyType: string;
      SourceCoverProxyMode?: string;
      DisableYellowFilter: boolean;
      FluidSearch: boolean;
      SiteIconStagingToken?: string;
      RemoveSiteIcon?: boolean;
    };

    // 参数校验
    if (
      typeof SiteName !== 'string' ||
      typeof SiteIcon !== 'string' ||
      typeof Announcement !== 'string' ||
      typeof FooterText !== 'string' ||
      typeof EnableLiveEntry !== 'boolean' ||
      typeof DefaultAggregateSearch !== 'boolean' ||
      typeof EnableOptimization !== 'boolean' ||
      typeof LiveDirectConnect !== 'boolean' ||
      typeof SearchDownstreamMaxPage !== 'number' ||
      typeof SiteInterfaceCacheTime !== 'number' ||
      typeof DoubanProxyType !== 'string' ||
      (BangumiDataSource !== undefined &&
        typeof BangumiDataSource !== 'string') ||
      typeof DoubanImageProxyType !== 'string' ||
      (SourceCoverProxyMode !== undefined &&
        typeof SourceCoverProxyMode !== 'string') ||
      typeof DisableYellowFilter !== 'boolean' ||
      typeof FluidSearch !== 'boolean' ||
      (SiteIconStagingToken !== undefined &&
        typeof SiteIconStagingToken !== 'string') ||
      (RemoveSiteIcon !== undefined && typeof RemoveSiteIcon !== 'boolean')
    ) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    if (SiteIconStagingToken && RemoveSiteIcon) {
      return NextResponse.json({ error: '站点图标操作冲突' }, { status: 400 });
    }

    if (
      SiteIconStagingToken &&
      (!SiteIcon.startsWith('/api/admin/site-icon') ||
        !hasStagedSiteIcon(SiteIconStagingToken))
    ) {
      return NextResponse.json(
        { error: '暂存的站点图标不存在' },
        { status: 400 },
      );
    }

    if (
      DoubanProxyType === 'custom' ||
      BangumiDataSource === 'custom' ||
      DoubanImageProxyType === 'custom'
    ) {
      return NextResponse.json(
        { error: '站点配置不支持自定义代理，请在本地设置中配置' },
        { status: 400 },
      );
    }

    if (
      SourceCoverProxyMode !== undefined &&
      normalizeSourceCoverProxyMode(SourceCoverProxyMode) !==
        SourceCoverProxyMode
    ) {
      return NextResponse.json(
        { error: '源站封面加载模式无效' },
        { status: 400 },
      );
    }

    const adminConfig = await getConfig();
    const announcementChanged =
      adminConfig.SiteConfig.Announcement !== Announcement;

    // 更新缓存中的站点设置
    adminConfig.SiteConfig = {
      ...adminConfig.SiteConfig,
      SiteName,
      SiteIcon:
        typeof SiteIcon === 'string'
          ? SiteIcon
          : adminConfig.SiteConfig.SiteIcon || '',
      Announcement,
      AnnouncementVersion: announcementChanged
        ? randomUUID()
        : adminConfig.SiteConfig.AnnouncementVersion,
      AnnouncementPublishedAt: announcementChanged
        ? Date.now()
        : adminConfig.SiteConfig.AnnouncementPublishedAt,
      FooterText,
      EnableLiveEntry,
      DefaultAggregateSearch,
      EnableOptimization,
      LiveDirectConnect,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      DoubanProxyType: normalizeSiteDoubanProxyType(DoubanProxyType),
      DoubanProxy: '',
      BangumiDataSource: normalizeSiteBangumiDataSource(
        BangumiDataSource || adminConfig.SiteConfig.BangumiDataSource,
      ),
      BangumiProxy: '',
      DoubanImageProxyType:
        normalizeSiteDoubanImageProxyType(DoubanImageProxyType),
      DoubanImageProxy: '',
      SourceCoverProxyMode: normalizeSourceCoverProxyMode(
        SourceCoverProxyMode ?? adminConfig.SiteConfig.SourceCoverProxyMode,
      ),
      DisableYellowFilter,
      FluidSearch,
    };

    // 写入数据库
    await saveConfig(adminConfig);

    if (SiteIconStagingToken) {
      commitStagedSiteIcon(SiteIconStagingToken);
    } else if (RemoveSiteIcon) {
      removeSiteIcon();
    }

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
