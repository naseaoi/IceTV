import { createSharedPlaybackTask } from '@/features/play/lib/sharedPlaybackTask';
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
import { ResourceLimitError } from '@/lib/server-resource-errors';
import { createSharedServerCache } from '@/lib/shared-server-cache';
import {
  hasSignedUrlParams,
  SIGNED_URL_PARAM_RE,
} from '@/lib/signed-url-params';
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
  signal?: AbortSignal;
  identity?: string;
  proxyPoolStickyKey?: string;
  startedAt: number;
  proxyMode: string;
  userAction: string | null;
  userInitiated: boolean;
};

const M3U8_TTL = { freshMs: 60_000, staleMs: 60_000 };
// 详情缓存最长 30 分钟，剧集地址的有效期只按这个量级假设；路径里带令牌的分片地址无法识别，不能缓存更久
const ENDED_MEDIA_M3U8_TTL = {
  freshMs: 20 * 60 * 1000,
  staleMs: 10 * 60 * 1000,
};

const m3u8Cache = createSharedServerCache<M3U8CacheEntry>({
  name: 'proxy-m3u8',
  ...M3U8_TTL,
  getTtl: getM3U8CacheTtl,
  ...getServerCacheBudget('proxy-m3u8'),
  maxWaitMs: 10_000,
  shouldCache: (entry) =>
    !isSignedM3U8Url(entry.finalUrl) &&
    (entry.content.includes('#EXT-X-ENDLIST') ||
      entry.content.includes('#EXT-X-STREAM-INF')),
});

const MAX_M3U8_BYTES = 2 * 1024 * 1024;
const m3u8RefreshInflight = new Map<string, Promise<void>>();
const m3u8LoadInflight = new Map<
  string,
  {
    task: ReturnType<typeof createSharedPlaybackTask<M3U8LoadResult>>;
    done: Promise<unknown>;
  }
>();

async function getProxyRequestTimeoutMs(
  source: string | null,
): Promise<number> {
  const config = await getConfigForRead();
  return resolveVodM3U8ProxyTimeoutMs(
    source,
    normalizeRuntimeParams(config.SiteConfig).ProxyRequestTimeoutSeconds * 1000,
  );
}

export const isSignedM3U8Url = hasSignedUrlParams;

// 完结的媒体清单内容不再变化，但内嵌的签名分片或密钥地址会过期，只有不含签名参数时才长缓存
function getM3U8CacheTtl(entry: M3U8CacheEntry) {
  const { content } = entry;
  const endedMediaPlaylist =
    content.includes('#EXT-X-ENDLIST') &&
    !content.includes('#EXT-X-STREAM-INF');
  return endedMediaPlaylist && !SIGNED_URL_PARAM_RE.test(content)
    ? ENDED_MEDIA_M3U8_TTL
    : M3U8_TTL;
}

function getM3U8CacheKey(url: string, source: string | null): string {
  return `${source?.trim().toLowerCase() || 'unknown'}\0${url}`;
}

export function peekM3U8Cache(url: string, source: string | null) {
  return m3u8Cache.peek(getM3U8CacheKey(url, source));
}

export function refreshM3U8Cache(
  url: string,
  ua: string,
  source: string | null,
  isLive = false,
  identity?: string,
  proxyPoolStickyKey?: string,
): Promise<void> {
  const cacheKey = getM3U8CacheKey(url, source);
  const existing = m3u8RefreshInflight.get(cacheKey);
  if (existing) return existing;

  const task = m3u8Cache
    .refresh(cacheKey, async () => {
      const loaded = await fetchM3U8Data(url, ua, source, isLive, {
        identity,
        proxyPoolStickyKey,
        startedAt: Date.now(),
        proxyMode: 'server-proxy',
        userAction: null,
        userInitiated: false,
      });
      return toM3U8CacheEntry(loaded);
    })
    .catch((error) => {
      console.warn('m3u8 后台刷新失败:', error);
    })
    .finally(() => {
      m3u8RefreshInflight.delete(cacheKey);
    });

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
  skipCache = skipCache || isLive || isSignedM3U8Url(url);
  const key = getM3U8LoadInflightKey(url, ua, source, isLive, skipCache);
  if (context.signal?.aborted) {
    return Promise.reject(
      context.signal.reason ?? new DOMException('Aborted', 'AbortError'),
    );
  }
  const existing = m3u8LoadInflight.get(key);
  if (existing) {
    if (!existing.task.signal.aborted)
      return existing.task.consume(context.signal);
    // 等被取消的缓存 loader 退出，防止新消费者接到共享缓存内部的旧在途结果。
    return existing.done.then(() =>
      loadM3U8Data(url, ua, source, isLive, skipCache, context),
    );
  }

  let done!: Promise<unknown>;
  const task = createSharedPlaybackTask<M3U8LoadResult>((signal) => {
    const load = () =>
      fetchM3U8Data(url, ua, source, isLive, { ...context, signal });
    const pending = skipCache
      ? load()
      : m3u8Cache
          .getOrLoad(getM3U8CacheKey(url, source), async () =>
            toM3U8CacheEntry(await load()),
          )
          .then((entry) => ({ ...entry, status: 200, statusText: 'OK' }));
    done = pending
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (m3u8LoadInflight.get(key)?.task === task)
          m3u8LoadInflight.delete(key);
      });
    return pending;
  });
  m3u8LoadInflight.set(key, { task, done });
  return task.consume(context.signal);
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
            signal: context.signal,
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
        if (error instanceof ResourceLimitError || context.signal?.aborted)
          throw error;
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
    resourceContext: { identity: context.identity },
    proxyPoolStickyKey: context.proxyPoolStickyKey,
    useProxyPool: !isLive,
    skipInitialValidation: true,
    timeoutMs,
    signal: context.signal,
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
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
  const content = await readTextLimited(response, MAX_M3U8_BYTES);
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

  return {
    content,
    contentType: contentType || 'application/vnd.apple.mpegurl',
    finalUrl,
    loadedAt,
    status: response.status,
    statusText: response.statusText,
  };
}

function toM3U8CacheEntry(result: M3U8LoadResult): M3U8CacheEntry {
  return {
    content: result.content,
    contentType: result.contentType,
    finalUrl: result.finalUrl,
    loadedAt: result.loadedAt,
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
