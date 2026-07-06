import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import type { ApiSite } from '@/lib/config';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import {
  isGirigiriSource,
  resolveGirigiriEpisodePlayUrlByPath,
} from '@/lib/downstream-sources/giri';
import {
  isXgcartoonSource,
  resolveXgcartoonEpisodeUrlByPath,
} from '@/lib/downstream-sources/xgcartoon';
import { parseLazyEpisodeUrl } from '@/lib/lazy-episodes';
import { createSwrCache } from '@/lib/server-cache';

export const runtime = 'nodejs';
const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';

const episodeUrlCache = createSwrCache<string>({
  name: 'episode-url',
  freshMs: 30 * 60 * 1000,
  staleMs: 2 * 60 * 60 * 1000,
  maxSize: 5000,
});

function matchesLazyKind(kind: string, apiSite: ApiSite): boolean {
  if (kind === 'giri') return isGirigiriSource(apiSite);
  if (kind === 'xgcartoon') return isXgcartoonSource(apiSite);
  return false;
}

async function resolveEpisodeUrl(
  kind: string,
  apiSite: ApiSite,
  path: string,
): Promise<string> {
  const resolved =
    kind === 'giri'
      ? await resolveGirigiriEpisodePlayUrlByPath(apiSite, path)
      : await resolveXgcartoonEpisodeUrlByPath(apiSite, path);
  if (!resolved) {
    throw new Error('播放地址解析失败');
  }
  return resolved;
}

export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  const { searchParams } = new URL(request.url);
  const sourceCode = searchParams.get('source');
  const lazyUrl = searchParams.get('url');

  if (!sourceCode || !lazyUrl) {
    return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
  }

  const target = parseLazyEpisodeUrl(lazyUrl);
  if (!target) {
    return NextResponse.json({ error: '无效的集数地址' }, { status: 400 });
  }

  try {
    const config = await getConfigForRead();
    const apiSites = await getAvailableApiSites(guardResult.username, config);
    const apiSite = apiSites.find((site) => site.key === sourceCode);

    if (!apiSite || !matchesLazyKind(target.kind, apiSite)) {
      return NextResponse.json({ error: '无效的API来源' }, { status: 400 });
    }

    const cacheKey = `${sourceCode}::${lazyUrl}`;
    const url = IS_DEVELOPMENT
      ? await resolveEpisodeUrl(target.kind, apiSite, target.path)
      : await episodeUrlCache.getOrLoad(cacheKey, () =>
          resolveEpisodeUrl(target.kind, apiSite, target.path),
        );

    return NextResponse.json(
      { url },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
