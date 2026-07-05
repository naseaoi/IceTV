import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { normalizeRuntimeParams } from '@/lib/runtime-params';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const resourceId = searchParams.get('resourceId');

  if (!query || !resourceId) {
    return NextResponse.json(
      { result: null, error: '缺少必要参数: q 或 resourceId' },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const config = await getConfigForRead();
  const apiSites = await getAvailableApiSites(guardResult.username, config);
  const maxSearchPages = normalizeRuntimeParams(
    config.SiteConfig,
  ).SearchDownstreamMaxPage;

  try {
    // 根据 resourceId 查找对应的 API 站点
    const targetSite = apiSites.find((site) => site.key === resourceId);
    if (!targetSite) {
      return NextResponse.json(
        {
          error: `未找到指定的视频源: ${resourceId}`,
          result: null,
        },
        { status: 404 },
      );
    }

    const results = await searchFromApi(targetSite, query, { maxSearchPages });
    let result = results.filter((r) => r.title === query);
    if (!config.SiteConfig.DisableYellowFilter) {
      result = result.filter((item) => {
        const typeName = item.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }
    if (result.length === 0) {
      return NextResponse.json(
        {
          error: '未找到结果',
          result: null,
        },
        { status: 404 },
      );
    } else {
      return NextResponse.json(
        { results: result },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: '搜索失败',
        result: null,
      },
      { status: 500 },
    );
  }
}
