import { NextRequest, NextResponse } from 'next/server';

import {
  shouldRunAdDetection,
  stripAdSegmentsByPhysicalSignal,
} from '@/lib/ad-segment-detector';
import { getBaseUrl, resolveUrl } from '@/lib/live';
import {
  readTextLimited,
  ResponseSizeLimitError,
} from '@/lib/proxy-response-limits';
import { appendProxySignature, authorizeProxyRequest } from '@/lib/proxy-auth';
import { createSwrCache } from '@/lib/server-cache';
import { isSourceCorsCapable } from '@/lib/source-capability';
import {
  fetchWithUrlGuard,
  UrlValidationError,
  validateProxyUrlForRequest,
} from '@/lib/url-guard';

import { getProxySourceKey, resolveProxyUserAgent } from '../utils';

export const runtime = 'nodejs';

// ================================================================
// VOD M3U8 清单缓存（SWR 软过期 + 请求合并）
// - 只缓存 VOD / Master playlist，直播清单不缓存
// - fresh 60s：期内直接返回
// - stale 60s：返回旧内容同时后台刷新，并发同 URL 自动合并
// ================================================================

type M3U8CacheEntry = {
  content: string;
  contentType: string;
  finalUrl: string;
};

const m3u8Cache = createSwrCache<M3U8CacheEntry>({
  name: 'proxy-m3u8',
  freshMs: 60_000,
  staleMs: 60_000,
  maxSize: 500,
});

// 识别带 token/签名的短时效 URL：命中后跳过本地 SWR 缓存，
// 避免缓存把过期 token 沉淀下来导致 hls.js 拉 ts 直接 403。
// 只匹配 query 中的明显签名字段；保守一点漏判好过误判。
const SIGNED_URL_PARAM_RE =
  /[?&](sign|signature|auth_key|auth|token|expires?|expire|hmac|x-amz-signature|security_token|oss_expires|wssecret|wstime|ccode|ksign)=/i;
const MAX_M3U8_BYTES = 2 * 1024 * 1024;

function isSignedM3U8Url(rawUrl: string): boolean {
  if (!rawUrl) return false;
  if (!rawUrl.includes('?')) return false;
  return SIGNED_URL_PARAM_RE.test(rawUrl);
}

// 软过期后台刷新：同 URL 并发刷新请求合并，避免雷群
const m3u8RefreshInflight = new Map<string, Promise<void>>();

function refreshM3U8Cache(
  url: string,
  ua: string,
  source: string | null,
): Promise<void> {
  const existing = m3u8RefreshInflight.get(url);
  if (existing) return existing;

  const task = (async () => {
    try {
      const response = await fetchWithUrlGuard(url, {
        cache: 'no-cache',
        redirect: 'follow',
        credentials: 'same-origin',
        headers: { 'User-Agent': ua },
      });
      if (!response.ok) return;
      const contentType = response.headers.get('Content-Type') || '';
      if (
        !contentType.toLowerCase().includes('mpegurl') &&
        !contentType.toLowerCase().includes('octet-stream')
      ) {
        return;
      }
      let content = await readTextLimited(response, MAX_M3U8_BYTES);
      // 仅对 VOD/Master 更新缓存
      if (
        !content.includes('#EXT-X-ENDLIST') &&
        !content.includes('#EXT-X-STREAM-INF')
      ) {
        return;
      }
      // 针对特定源站尝试剔除广告段；失败或无信号时原样返回
      if (shouldRunAdDetection(source)) {
        try {
          content = await stripAdSegmentsByPhysicalSignal(
            content,
            response.url,
            ua,
          );
        } catch {
          /* 识别失败不影响缓存刷新 */
        }
      }
      m3u8Cache.set(url, {
        content,
        contentType,
        finalUrl: response.url,
      });
    } catch {
      /* 后台刷新失败保留旧值 */
    } finally {
      m3u8RefreshInflight.delete(url);
    }
  })();

  m3u8RefreshInflight.set(url, task);
  return task;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const allowCORS = searchParams.get('allowCORS') === 'true';
  const source = getProxySourceKey(searchParams);
  const isLive = searchParams.get('icetv-live') === '1';
  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  const validation = await validateProxyUrlForRequest(url);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 403 });
  }

  const authFailure = await authorizeProxyRequest(
    request,
    'm3u8',
    validation.url,
  );
  if (authFailure) {
    return authFailure;
  }

  const ua = await resolveProxyUserAgent(source);
  const skipCache = isSignedM3U8Url(validation.url);

  try {
    // 查询 VOD 清单缓存（fresh/stale 皆命中；stale 命中时触发后台刷新）
    const cached = skipCache ? null : m3u8Cache.peek(validation.url);
    if (cached) {
      const { value, fresh } = cached;
      if (!fresh) {
        // 软过期：后台刷新，不阻塞当前响应
        void refreshM3U8Cache(validation.url, ua, source);
      }
      const baseUrl = getBaseUrl(value.finalUrl);
      const modifiedContent = await rewriteM3U8Content(
        value.content,
        baseUrl,
        request,
        allowCORS,
        source,
        isLive,
      );

      const headers = new Headers();
      headers.set('Content-Type', value.contentType);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Range, Origin, Accept',
      );
      headers.set('Cache-Control', 'no-cache');
      headers.set(
        'Access-Control-Expose-Headers',
        'Content-Length, Content-Range',
      );
      return new Response(modifiedContent, { status: 200, headers });
    }

    const response = await fetchWithUrlGuard(validation.url, {
      cache: 'no-cache',
      redirect: 'follow',
      credentials: 'same-origin',
      headers: {
        'User-Agent': ua,
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch m3u8' },
        { status: 500 },
      );
    }

    const contentType = response.headers.get('Content-Type') || '';
    if (
      contentType.toLowerCase().includes('mpegurl') ||
      contentType.toLowerCase().includes('octet-stream')
    ) {
      const finalUrl = response.url;
      let m3u8Content = await readTextLimited(response, MAX_M3U8_BYTES);
      const baseUrl = getBaseUrl(finalUrl);

      // 特定源站广告段剔除（基于时长众数 + 段均码率双信号）。
      // 直播不走此路径；识别失败则降级为原始内容。
      if (!isLive && shouldRunAdDetection(source)) {
        try {
          m3u8Content = await stripAdSegmentsByPhysicalSignal(
            m3u8Content,
            finalUrl,
            ua,
          );
        } catch {
          /* 识别失败不影响主流程 */
        }
      }

      // VOD / Master playlist 写入缓存（直播清单不缓存；带签名 token 的短时效 URL 也跳过）
      if (
        !skipCache &&
        (m3u8Content.includes('#EXT-X-ENDLIST') ||
          m3u8Content.includes('#EXT-X-STREAM-INF'))
      ) {
        m3u8Cache.set(validation.url, {
          content: m3u8Content,
          contentType,
          finalUrl,
        });
      }

      const modifiedContent = await rewriteM3U8Content(
        m3u8Content,
        baseUrl,
        request,
        allowCORS,
        source,
        isLive,
      );

      const headers = new Headers();
      headers.set('Content-Type', contentType);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Range, Origin, Accept',
      );
      headers.set('Cache-Control', 'no-cache');
      headers.set(
        'Access-Control-Expose-Headers',
        'Content-Length, Content-Range',
      );
      return new Response(modifiedContent, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    const headers = new Headers();
    headers.set(
      'Content-Type',
      response.headers.get('Content-Type') || 'application/vnd.apple.mpegurl',
    );
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Range, Origin, Accept',
    );
    headers.set('Cache-Control', 'no-cache');
    headers.set(
      'Access-Control-Expose-Headers',
      'Content-Length, Content-Range',
    );

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    if (error instanceof UrlValidationError) {
      return NextResponse.json({ error: error.reason }, { status: 403 });
    }
    if (error instanceof ResponseSizeLimitError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }

    return NextResponse.json(
      { error: 'Failed to fetch m3u8' },
      { status: 500 },
    );
  }
}

async function rewriteM3U8Content(
  content: string,
  baseUrl: string,
  req: NextRequest,
  allowCORS: boolean,
  source: string | null,
  isLive: boolean,
): Promise<string> {
  const referer = req.headers.get('referer');
  let protocol = 'http';
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      protocol = refererUrl.protocol.replace(':', '');
    } catch (error) {
      // ignore
    }
  }

  const host = req.headers.get('host');
  const proxyBase = `${protocol}://${host}/api/proxy`;

  // 源站 CORS 能力探测结果：若已确认支持，即便 admin 将其标为 server-proxy，
  // 也把 segment / key URL 直接输出为源站原始 URL，省掉一跳服务端转发。
  // m3u8（master/variant）仍走代理，避免递归嵌套与 CORS 复杂度。
  // 直播场景跳过此优化：直播通常依赖服务端注入特定 UA / 处理鉴权，直连易失败。
  const corsCapable =
    !isLive && source ? isSourceCorsCapable(source) === true : false;
  const effectiveAllowCors = allowCORS || corsCapable;

  const lines = content.split('\n');
  const rewrittenLines: string[] = [];

  const buildProxyPath = async (
    path: 'segment' | 'm3u8' | 'key',
    targetUrl: string,
    extra: Record<string, string> = {},
  ) => {
    const params = new URLSearchParams({
      url: targetUrl,
      ...extra,
    });
    if (source) {
      params.set('icetv-source', source);
    }
    if (isLive) {
      params.set('icetv-live', '1');
    }
    await appendProxySignature(params, path, targetUrl);
    return `${proxyBase}/${path}?${params.toString()}`;
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    if (line && !line.startsWith('#')) {
      const resolvedUrl = resolveUrl(baseUrl, line);
      const proxyUrl = effectiveAllowCors
        ? resolvedUrl
        : await buildProxyPath('segment', resolvedUrl);
      rewrittenLines.push(proxyUrl);
      continue;
    }

    if (line.startsWith('#EXT-X-MAP:')) {
      line = await rewriteMapUri(
        line,
        baseUrl,
        proxyBase,
        source,
        effectiveAllowCors,
        isLive,
      );
    }

    if (line.startsWith('#EXT-X-KEY:')) {
      line = await rewriteKeyUri(
        line,
        baseUrl,
        proxyBase,
        source,
        effectiveAllowCors,
        isLive,
      );
    }

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      rewrittenLines.push(line);
      if (i + 1 < lines.length) {
        i++;
        const nextLine = lines[i].trim();
        if (nextLine && !nextLine.startsWith('#')) {
          const resolvedUrl = resolveUrl(baseUrl, nextLine);
          const proxyUrl = await buildProxyPath(
            'm3u8',
            resolvedUrl,
            allowCORS ? { allowCORS: 'true' } : {},
          );
          rewrittenLines.push(proxyUrl);
        } else {
          rewrittenLines.push(nextLine);
        }
      }
      continue;
    }

    rewrittenLines.push(line);
  }

  return rewrittenLines.join('\n');
}

async function rewriteMapUri(
  line: string,
  baseUrl: string,
  proxyBase: string,
  source: string | null,
  allowDirect: boolean,
  isLive: boolean,
): Promise<string> {
  const uriMatch = line.match(/URI="([^"]+)"/);
  if (uriMatch) {
    const originalUri = uriMatch[1];
    const resolvedUrl = resolveUrl(baseUrl, originalUri);
    if (allowDirect) {
      return line.replace(uriMatch[0], `URI="${resolvedUrl}"`);
    }
    const params = new URLSearchParams({ url: resolvedUrl });
    if (source) {
      params.set('icetv-source', source);
    }
    if (isLive) {
      params.set('icetv-live', '1');
    }
    await appendProxySignature(params, 'segment', resolvedUrl);
    const proxyUrl = `${proxyBase}/segment?${params.toString()}`;
    return line.replace(uriMatch[0], `URI="${proxyUrl}"`);
  }
  return line;
}

async function rewriteKeyUri(
  line: string,
  baseUrl: string,
  proxyBase: string,
  source: string | null,
  allowDirect: boolean,
  isLive: boolean,
): Promise<string> {
  const uriMatch = line.match(/URI="([^"]+)"/);
  if (uriMatch) {
    const originalUri = uriMatch[1];
    const resolvedUrl = resolveUrl(baseUrl, originalUri);
    if (allowDirect) {
      return line.replace(uriMatch[0], `URI="${resolvedUrl}"`);
    }
    const params = new URLSearchParams({ url: resolvedUrl });
    if (source) {
      params.set('icetv-source', source);
    }
    if (isLive) {
      params.set('icetv-live', '1');
    }
    await appendProxySignature(params, 'key', resolvedUrl);
    const proxyUrl = `${proxyBase}/key?${params.toString()}`;
    return line.replace(uriMatch[0], `URI="${proxyUrl}"`);
  }
  return line;
}
