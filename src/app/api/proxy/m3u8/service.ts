import { getAdFilterCacheNamespace } from '@/features/play/lib/ad-filter-strategy-registry';
import { filterM3U8AdsForSource } from '@/features/play/lib/ad-segment-detector';
import { resolveVodM3U8ProxyTimeoutMs } from '@/features/play/lib/vodSourcePlaybackPolicy';
import { getServerCacheBudget } from '@/lib/cache-budget-profile';
import { getConfigForRead } from '@/lib/config';
import {
  fetchResponseThroughProxy,
  getProxyUrlForTarget,
} from '@/lib/http-proxy-json';
import {
  classifyProxyFailure,
  logProxyFailure,
  ProxyRouteError,
} from '@/lib/proxy-diagnostics';
import { readTextLimited } from '@/lib/proxy-response-limits';
import { normalizeRuntimeParams } from '@/lib/runtime-params';
import { createSwrCache } from '@/lib/server-cache';
import { fetchWithUrlGuard } from '@/lib/url-guard';

type M3U8CacheEntry = {
  content: string;
  contentType: string;
  finalUrl: string;
  loadedAt: number;
};

export type M3U8LoadResult = M3U8CacheEntry & {
  status: number;
  statusText: string;
};

export type M3U8ProxyRequestContext = {
  startedAt: number;
  proxyMode: string;
  userAction: string | null;
  userInitiated: boolean;
};

const m3u8Cache = createSwrCache<M3U8CacheEntry>({
  name: 'proxy-m3u8',
  freshMs: 60_000,
  staleMs: 60_000,
  ...getServerCacheBudget('proxy-m3u8'),
});

const SIGNED_URL_PARAM_RE =
  /[?&](sign|signature|auth_key|auth|token|expires?|expire|hmac|x-amz-signature|security_token|oss_expires|wssecret|wstime|ccode|ksign)=/i;
const MAX_M3U8_BYTES = 2 * 1024 * 1024;
const m3u8RefreshInflight = new Map<string, Promise<void>>();
const m3u8LoadInflight = new Map<string, Promise<M3U8LoadResult>>();

async function getProxyRequestTimeoutMs(
  source: string | null,
): Promise<number> {
  const config = await getConfigForRead();
  return resolveVodM3U8ProxyTimeoutMs(
    source,
    normalizeRuntimeParams(config.SiteConfig).ProxyRequestTimeoutSeconds * 1000,
  );
}

export function isSignedM3U8Url(rawUrl: string): boolean {
  if (!rawUrl) return false;
  if (!rawUrl.includes('?')) return false;
  return SIGNED_URL_PARAM_RE.test(rawUrl);
}

function getM3U8CacheKey(url: string, source: string | null): string {
  return `${getAdFilterCacheNamespace(source)}\0${url}`;
}

export function peekM3U8Cache(url: string, source: string | null) {
  return m3u8Cache.peek(getM3U8CacheKey(url, source));
}

export function refreshM3U8Cache(
  url: string,
  ua: string,
  source: string | null,
): Promise<void> {
  const cacheKey = getM3U8CacheKey(url, source);
  const existing = m3u8RefreshInflight.get(cacheKey);
  if (existing) return existing;

  const task = (async () => {
    try {
      const timeoutMs = await getProxyRequestTimeoutMs(source);
      const response = await fetchWithUrlGuard(url, {
        cache: 'no-cache',
        redirect: 'follow',
        credentials: 'same-origin',
        headers: { 'User-Agent': ua },
        skipInitialValidation: true,
        timeoutMs,
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
      if (
        !content.includes('#EXT-X-ENDLIST') &&
        !content.includes('#EXT-X-STREAM-INF')
      ) {
        return;
      }
      try {
        content = await filterM3U8AdsForSource(
          content,
          response.url,
          ua,
          source,
        );
      } catch (error) {
        console.warn('m3u8 后台广告段检测失败:', error);
      }
      m3u8Cache.set(cacheKey, {
        content,
        contentType,
        finalUrl: response.url,
        loadedAt: Date.now(),
      });
    } catch (error) {
      console.warn('m3u8 后台刷新失败:', error);
    } finally {
      m3u8RefreshInflight.delete(cacheKey);
    }
  })();

  m3u8RefreshInflight.set(cacheKey, task);
  return task;
}

export function loadM3U8Data(
  url: string,
  ua: string,
  source: string | null,
  isLive: boolean,
  skipCache: boolean,
  context: M3U8ProxyRequestContext,
): Promise<M3U8LoadResult> {
  const key = getM3U8LoadInflightKey(url, ua, source, isLive, skipCache);
  const existing = m3u8LoadInflight.get(key);
  if (existing) return existing;

  const task = fetchM3U8Data(
    url,
    ua,
    source,
    isLive,
    skipCache,
    context,
  ).finally(() => {
    m3u8LoadInflight.delete(key);
  });
  m3u8LoadInflight.set(key, task);
  return task;
}

function getM3U8LoadInflightKey(
  url: string,
  ua: string,
  source: string | null,
  isLive: boolean,
  skipCache: boolean,
) {
  return [
    url,
    ua,
    source || '',
    isLive ? 'live' : 'vod',
    skipCache ? 'signed' : 'cacheable',
  ].join('\0');
}

async function fetchM3U8Data(
  url: string,
  ua: string,
  source: string | null,
  isLive: boolean,
  skipCache: boolean,
  context: M3U8ProxyRequestContext,
): Promise<M3U8LoadResult> {
  const timeoutMs = await getProxyRequestTimeoutMs(source);
  if (isLive) {
    const proxyUrl = getProxyUrlForTarget(new URL(url));
    if (proxyUrl) {
      try {
        const response = await fetchResponseThroughProxy(
          new URL(url),
          proxyUrl,
          {
            timeoutMs,
            userAgent: ua,
            maxBytes: MAX_M3U8_BYTES,
            accept: 'application/vnd.apple.mpegurl,text/plain,*/*',
          },
        );
        const content = response.body.toString('utf8');
        const contentType = response.headers.get('content-type') || '';
        assertM3U8Content(content, contentType, {
          route: 'm3u8',
          source,
          targetUrl: url,
          proxyUrl,
          stage: 'response',
          reason: 'content-type',
          upstreamStatus: response.status,
          status: 502,
          elapsedMs: Date.now() - context.startedAt,
          proxyMode: 'env-proxy',
          isLive,
          userAction: context.userAction,
          userInitiated: context.userInitiated,
        });
        return {
          content,
          contentType: contentType || 'application/vnd.apple.mpegurl',
          finalUrl: url,
          loadedAt: Date.now(),
          status: response.status,
          statusText: response.statusText,
        };
      } catch (error) {
        logProxyFailure(
          classifyProxyFailure(error, {
            route: 'm3u8',
            source,
            targetUrl: url,
            proxyUrl,
            stage: 'proxy',
            reason: 'proxy-response',
            status: 502,
            elapsedMs: Date.now() - context.startedAt,
            proxyMode: 'env-proxy',
            isLive,
            userAction: context.userAction,
            userInitiated: context.userInitiated,
          }),
        );
      }
    }
  }

  const response = await fetchWithUrlGuard(url, {
    cache: 'no-cache',
    redirect: 'follow',
    credentials: 'same-origin',
    headers: {
      'User-Agent': ua,
    },
    skipInitialValidation: true,
    timeoutMs,
  });

  if (!response.ok) {
    throw new ProxyRouteError({
      route: 'm3u8',
      source,
      targetUrl: response.url || url,
      stage: 'upstream',
      reason: 'upstream-http',
      upstreamStatus: response.status,
      status: response.status,
      message: `Upstream m3u8 returned HTTP ${response.status}`,
      elapsedMs: Date.now() - context.startedAt,
      proxyMode: context.proxyMode,
      isLive,
      userAction: context.userAction,
      userInitiated: context.userInitiated,
    });
  }

  const contentType = response.headers.get('Content-Type') || '';
  const finalUrl = response.url;
  let content = await readTextLimited(response, MAX_M3U8_BYTES);
  const loadedAt = Date.now();
  assertM3U8Content(content, contentType, {
    route: 'm3u8',
    source,
    targetUrl: finalUrl || url,
    stage: 'response',
    reason: 'content-type',
    upstreamStatus: response.status,
    status: 502,
    elapsedMs: Date.now() - context.startedAt,
    proxyMode: context.proxyMode,
    isLive,
    userAction: context.userAction,
    userInitiated: context.userInitiated,
  });

  if (!isLive) {
    try {
      content = await filterM3U8AdsForSource(content, finalUrl, ua, source);
    } catch (error) {
      console.warn('m3u8 广告段检测失败:', error);
    }
  }

  if (
    !skipCache &&
    (content.includes('#EXT-X-ENDLIST') ||
      content.includes('#EXT-X-STREAM-INF'))
  ) {
    m3u8Cache.set(getM3U8CacheKey(url, source), {
      content,
      contentType: contentType || 'application/vnd.apple.mpegurl',
      finalUrl,
      loadedAt,
    });
  }

  return {
    content,
    contentType: contentType || 'application/vnd.apple.mpegurl',
    finalUrl,
    loadedAt,
    status: response.status,
    statusText: response.statusText,
  };
}

function assertM3U8Content(
  content: string,
  contentType: string,
  context: ConstructorParameters<typeof ProxyRouteError>[0],
): void {
  if (content.includes('#EXTM3U')) {
    return;
  }

  const normalized = contentType.toLowerCase();
  if (
    normalized.includes('mpegurl') ||
    normalized.includes('octet-stream') ||
    normalized.includes('text/plain')
  ) {
    return;
  }

  throw new ProxyRouteError({
    ...context,
    message: `Unexpected m3u8 content type: ${contentType || 'empty'}`,
  });
}

export function getM3U8CacheStats() {
  return m3u8Cache.stats();
}
