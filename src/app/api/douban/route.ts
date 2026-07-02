import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import { createSwrCache } from '@/lib/server-cache';
import { DoubanItem, DoubanResult } from '@/lib/types';

interface DoubanApiResponse {
  subjects: Array<{
    id: string;
    title: string;
    cover: string;
    rate: string;
  }>;
}

export const runtime = 'nodejs';

const doubanRouteCache = createSwrCache<DoubanResult>({
  name: 'douban-route',
  freshMs: 30 * 60 * 1000,
  staleMs: 30 * 60 * 1000,
  maxSize: 500,
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // 获取参数
  const type = searchParams.get('type');
  const tag = searchParams.get('tag');
  const pageSize = parseInt(searchParams.get('pageSize') || '16');
  const pageStart = parseInt(searchParams.get('pageStart') || '0');

  // 验证参数
  if (!type || !tag) {
    return NextResponse.json(
      { error: '缺少必要参数: type 或 tag' },
      { status: 400 },
    );
  }

  if (!['tv', 'movie'].includes(type)) {
    return NextResponse.json(
      { error: 'type 参数必须是 tv 或 movie' },
      { status: 400 },
    );
  }

  if (pageSize < 1 || pageSize > 100) {
    return NextResponse.json(
      { error: 'pageSize 必须在 1-100 之间' },
      { status: 400 },
    );
  }

  if (pageStart < 0) {
    return NextResponse.json(
      { error: 'pageStart 不能小于 0' },
      { status: 400 },
    );
  }

  if (tag === 'top250') {
    return handleTop250(pageStart);
  }

  const target = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${tag}&sort=recommend&page_limit=${pageSize}&page_start=${pageStart}`;

  try {
    const response = await doubanRouteCache.getOrLoad(target, async () => {
      const doubanData = await fetchDoubanData<DoubanApiResponse>(target);
      const list: DoubanItem[] = doubanData.subjects.map((item) => ({
        id: item.id,
        title: item.title,
        poster: item.cover,
        rate: item.rate,
        year: '',
      }));

      return {
        code: 200,
        message: '获取成功',
        list,
      };
    });

    return createDoubanJsonResponse(response);
  } catch {
    return NextResponse.json({ error: '获取豆瓣数据失败' }, { status: 500 });
  }
}

async function handleTop250(pageStart: number) {
  const target = `https://movie.douban.com/top250?start=${pageStart}&filter=`;

  try {
    const response = await doubanRouteCache.getOrLoad(target, () =>
      fetchTop250Result(target),
    );
    return createDoubanJsonResponse(response);
  } catch {
    return NextResponse.json(
      { error: '获取豆瓣 Top250 数据失败' },
      { status: 500 },
    );
  }
}

async function fetchTop250Result(target: string): Promise<DoubanResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const fetchOptions = {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Referer: 'https://movie.douban.com/',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    },
  };

  try {
    const fetchResponse = await fetch(target, fetchOptions);

    if (!fetchResponse.ok) {
      throw new Error(`HTTP error! Status: ${fetchResponse.status}`);
    }

    const html = await fetchResponse.text();
    const moviePattern =
      /<div class="item">[\s\S]*?<a[^>]+href="https?:\/\/movie\.douban\.com\/subject\/(\d+)\/"[\s\S]*?<img[^>]+alt="([^"]+)"[^>]*src="([^"]+)"[\s\S]*?<span class="rating_num"[^>]*>([^<]*)<\/span>[\s\S]*?<\/div>/g;
    const movies: DoubanItem[] = [];
    let match;

    while ((match = moviePattern.exec(html)) !== null) {
      const id = match[1];
      const title = match[2];
      const cover = match[3];
      const rate = match[4] || '';
      const processedCover = cover.replace(/^http:/, 'https:');

      movies.push({
        id,
        title,
        poster: processedCover,
        rate,
        year: '',
      });
    }

    return {
      code: 200,
      message: '获取成功',
      list: movies,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function createDoubanJsonResponse(response: DoubanResult) {
  const cacheTime = await getCacheTime();
  return NextResponse.json(response, {
    headers: {
      'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
      'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
      'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
      'Netlify-Vary': 'query',
    },
  });
}
