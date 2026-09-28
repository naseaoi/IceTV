import type { HlsLoaderConstructor } from '@/features/play/lib/vodFragmentCacheRecovery';
import { normalizeSegmentCacheKey } from '@/lib/segment-cache-key';

export const FRAGMENT_MEMORY_CACHE_LIMITS = {
  maxEntries: 8,
  maxBytes: 24 * 1024 * 1024,
  ttlMs: 5 * 60 * 1000,
} as const;

const MAX_FRAGMENT_URL_LENGTH = 8_192;
const MAX_RECORDED_TIMING_MS = 120_000;
const FALLBACK_REMAINDER_TIMEOUT_MS = 20_000;

export type FragmentMemoryEntry = {
  data: Uint8Array;
  // false 表示 data 只是从第 0 字节开始的前缀，命中时需用 Range 补齐剩余部分
  complete: boolean;
  totalBytes: number | null;
  ttfbMs: number;
  transferMs: number;
};

type StoredEntry = { entry: FragmentMemoryEntry; storedAt: number };

export type FragmentMemoryCache = {
  put: (url: string, entry: FragmentMemoryEntry) => boolean;
  take: (url: string) => FragmentMemoryEntry | null;
  has: (url: string) => boolean;
  clear: () => void;
  getUsage: () => { entries: number; bytes: number };
};

export type FragmentMemoryCacheOptions = {
  maxEntries?: number;
  maxBytes?: number;
  ttlMs?: number;
  now?: () => number;
};

export function isCacheableFragmentUrl(url: unknown): url is string {
  if (
    typeof url !== 'string' ||
    url.length === 0 ||
    url.length > MAX_FRAGMENT_URL_LENGTH
  ) {
    return false;
  }
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function sanitizeTiming(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, MAX_RECORDED_TIMING_MS);
}

function isConsistentEntry(entry: FragmentMemoryEntry): boolean {
  const size = entry.data.byteLength;
  if (size === 0) return false;
  if (entry.totalBytes === null) return true;
  if (!Number.isInteger(entry.totalBytes)) return false;
  return entry.complete ? entry.totalBytes === size : entry.totalBytes > size;
}

export function createFragmentMemoryCache(
  options: FragmentMemoryCacheOptions = {},
): FragmentMemoryCache {
  const maxEntries =
    options.maxEntries ?? FRAGMENT_MEMORY_CACHE_LIMITS.maxEntries;
  const maxBytes = options.maxBytes ?? FRAGMENT_MEMORY_CACHE_LIMITS.maxBytes;
  const ttlMs = options.ttlMs ?? FRAGMENT_MEMORY_CACHE_LIMITS.ttlMs;
  const now = options.now ?? Date.now;
  const entries = new Map<string, StoredEntry>();
  let usedBytes = 0;

  const remove = (key: string) => {
    const stored = entries.get(key);
    if (!stored) return;
    entries.delete(key);
    usedBytes -= stored.entry.data.byteLength;
  };

  const pruneExpired = (at: number) => {
    entries.forEach((stored, key) => {
      if (at - stored.storedAt >= ttlMs) remove(key);
    });
  };

  const findLiveKey = (url: string): string | null => {
    if (!isCacheableFragmentUrl(url)) return null;
    const key = normalizeSegmentCacheKey(url);
    const stored = entries.get(key);
    if (!stored) return null;
    if (now() - stored.storedAt >= ttlMs) {
      remove(key);
      return null;
    }
    return key;
  };

  return {
    put(url, entry) {
      const size = entry.data.byteLength;
      if (
        !isCacheableFragmentUrl(url) ||
        !isConsistentEntry(entry) ||
        size > maxBytes ||
        maxEntries <= 0
      ) {
        return false;
      }
      const key = normalizeSegmentCacheKey(url);
      const at = now();
      pruneExpired(at);
      if (entries.get(key)?.entry.complete && !entry.complete) return false;
      remove(key);
      while (
        entries.size > 0 &&
        (entries.size >= maxEntries || usedBytes + size > maxBytes)
      ) {
        const oldestKey = entries.keys().next().value;
        if (typeof oldestKey !== 'string') break;
        remove(oldestKey);
      }
      entries.set(key, {
        entry: {
          ...entry,
          ttfbMs: sanitizeTiming(entry.ttfbMs),
          transferMs: sanitizeTiming(entry.transferMs),
        },
        storedAt: at,
      });
      usedBytes += size;
      return true;
    },
    take(url) {
      const key = findLiveKey(url);
      const stored = key ? entries.get(key) : undefined;
      if (!key || !stored) return null;
      remove(key);
      return stored.entry;
    },
    has(url) {
      return findLiveKey(url) !== null;
    },
    clear() {
      entries.clear();
      usedBytes = 0;
    },
    getUsage() {
      pruneExpired(now());
      return { entries: entries.size, bytes: usedBytes };
    },
  };
}

export const fragmentMemoryCache = createFragmentMemoryCache();

type LoadStats = {
  aborted: boolean;
  loaded: number;
  retry: number;
  total: number;
  chunkCount: number;
  bwEstimate: number;
  loading: { start: number; first: number; end: number };
  parsing: { start: number; end: number };
  buffering: { start: number; first: number; end: number };
};

type FragmentLoaderContext = {
  url: string;
  frag?: { bitrateTest?: boolean } | null;
  part?: unknown;
  headers?: Record<string, string>;
  rangeStart?: number;
  rangeEnd?: number;
};

type FragmentLoaderConfig = {
  timeout?: number;
  loadPolicy?: { maxTimeToFirstByteMs?: number; maxLoadTimeMs?: number };
};

type FragmentLoaderCallbacks = {
  onSuccess: (
    response: { url: string; data: ArrayBuffer; code: number },
    stats: LoadStats,
    context: FragmentLoaderContext,
    networkDetails: null,
  ) => void;
  onError: (
    error: { code: number; text: string },
    context: FragmentLoaderContext,
    networkDetails: null,
    stats: LoadStats,
  ) => void;
  onTimeout: (
    stats: LoadStats,
    context: FragmentLoaderContext,
    networkDetails: null,
  ) => void;
  onAbort?: (
    stats: LoadStats,
    context: FragmentLoaderContext,
    networkDetails: null,
  ) => void;
  onProgress?: (
    stats: LoadStats,
    context: FragmentLoaderContext,
    data: ArrayBuffer,
    networkDetails: null,
  ) => void;
};

type InnerLoader = {
  stats?: LoadStats;
  context?: unknown;
  load: (context: unknown, config: unknown, callbacks: unknown) => void;
  abort?: () => void;
  destroy?: () => void;
};

type RemainderResponse = {
  status: number;
  headers?: { get: (name: string) => string | null } | null;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type FragmentFetcher = (
  url: string,
  init: RequestInit,
) => Promise<RemainderResponse>;

export type FragmentMemoryLoaderOptions = {
  cache?: FragmentMemoryCache;
  fetcher?: FragmentFetcher;
};

function createLoadStats(): LoadStats {
  return {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  };
}

function resetLoadStats(stats: LoadStats): void {
  stats.aborted = false;
  stats.loaded = 0;
  stats.retry = 0;
  stats.total = 0;
  stats.chunkCount = 0;
  stats.bwEstimate = 0;
  stats.loading.start = 0;
  stats.loading.first = 0;
  stats.loading.end = 0;
}

function resolveCacheableFragmentUrl(
  context: FragmentLoaderContext | null | undefined,
): string | null {
  if (!context?.frag || context.part || context.frag.bitrateTest) return null;
  // 字节范围分片和测速分片只走原 loader
  if (context.rangeStart || context.rangeEnd) return null;
  return isCacheableFragmentUrl(context.url) ? context.url : null;
}

function resolvePositiveMs(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return FALLBACK_REMAINDER_TIMEOUT_MS;
}

function toTransferableBuffer(view: Uint8Array): ArrayBuffer {
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer as ArrayBuffer;
  }
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

type ParsedContentRange = {
  start: number;
  end: number;
  total: number | null;
};

export function parseContentRange(
  value: string | null | undefined,
): ParsedContentRange | null {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value?.trim() || '');
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === '*' ? null : Number(match[3]);
  if (end < start || (total !== null && end >= total)) return null;
  return { start, end, total };
}

type FragmentResponseMeta = {
  status: number;
  headers?: { get: (name: string) => string | null } | null;
};

function readResponseHeader(
  response: FragmentResponseMeta,
  name: string,
): string | null {
  try {
    return response.headers?.get(name) ?? null;
  } catch {
    return null;
  }
}

function parseByteCount(value: string | null): number | null {
  const trimmed = value?.trim() || '';
  if (!/^\d+$/.test(trimmed)) return null;
  const count = Number(trimmed);
  return Number.isSafeInteger(count) ? count : null;
}

// 只保留能确认是分片第 0 字节起原始字节的响应；内容编码后的字节无法与 Range 续传拼接
export function createFragmentEntryFromResponse(
  response: FragmentResponseMeta,
  data: Uint8Array,
  options: {
    streamEnded: boolean;
    requestedBytes: number | null;
    ttfbMs: number;
    transferMs: number;
  },
): FragmentMemoryEntry | null {
  const bytes = data.byteLength;
  if (bytes === 0) return null;
  const encoding = readResponseHeader(response, 'content-encoding');
  if (encoding && encoding.trim().toLowerCase() !== 'identity') return null;
  const timing = { ttfbMs: options.ttfbMs, transferMs: options.transferMs };

  if (response.status === 200) {
    const contentLength = parseByteCount(
      readResponseHeader(response, 'content-length'),
    );
    if (
      contentLength !== null &&
      (options.streamEnded ? contentLength !== bytes : contentLength < bytes)
    ) {
      return null;
    }
    const totalBytes = options.streamEnded ? bytes : contentLength;
    return { data, complete: totalBytes === bytes, totalBytes, ...timing };
  }
  if (response.status !== 206) return null;

  const rawRange = readResponseHeader(response, 'content-range');
  if (rawRange) {
    const range = parseContentRange(rawRange);
    if (
      !range ||
      range.start !== 0 ||
      (range.total !== null && range.total < bytes)
    ) {
      return null;
    }
    return {
      data,
      complete: range.total === bytes,
      totalBytes: range.total,
      ...timing,
    };
  }
  // 跨域直连读不到 Content-Range 时，只有流自然结束且短于请求区间才能断定拿到了整片
  if (options.requestedBytes === null) return null;
  const complete = options.streamEnded && bytes < options.requestedBytes;
  return { data, complete, totalBytes: complete ? bytes : null, ...timing };
}

function isValidRemainder(
  entry: FragmentMemoryEntry,
  remainderBytes: number,
  contentRange: string | null | undefined,
): boolean {
  const prefixBytes = entry.data.byteLength;
  if (remainderBytes <= 0) return false;
  const combined = prefixBytes + remainderBytes;
  if (entry.totalBytes !== null && combined !== entry.totalBytes) return false;
  // 跨域直连时 Content-Range 可能不可读，此时只能依赖已知总长校验
  if (!contentRange) return true;
  const range = parseContentRange(contentRange);
  if (!range) return false;
  return (
    range.start === prefixBytes &&
    range.end - range.start + 1 === remainderBytes &&
    (range.total === null || range.total === combined)
  );
}

// 命中完整条目直接交付内存数据；命中前缀条目只用 Range 补齐剩余字节，失败时回落原 loader 重新整片下载。
// 统计数据按原始请求的首字节耗时与传输耗时回填，避免内存交付被 ABR 当作超高带宽样本。
export function withFragmentMemoryCache(
  BaseLoader?: HlsLoaderConstructor,
  options: FragmentMemoryLoaderOptions = {},
): HlsLoaderConstructor {
  const cache = options.cache ?? fragmentMemoryCache;

  return class FragmentMemoryCacheLoader {
    readonly stats: LoadStats;
    private readonly inner: InnerLoader;
    private delegated = false;
    private settled = false;
    private activeContext: FragmentLoaderContext | null = null;
    private activeConfig: unknown = null;
    private callbacks: FragmentLoaderCallbacks | null = null;
    private pendingUrl: string | null = null;
    private pendingEntry: FragmentMemoryEntry | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private controller: AbortController | null = null;

    constructor(config: unknown) {
      const Base =
        BaseLoader ??
        (config as { loader?: HlsLoaderConstructor } | null)?.loader;
      if (!Base) {
        throw new Error('Fragment memory cache loader requires a base loader');
      }
      this.inner = new Base(config) as InnerLoader;
      this.stats = this.inner.stats ?? createLoadStats();
    }

    get context(): unknown {
      return this.delegated ? this.inner.context : this.activeContext;
    }

    load(context: unknown, config: unknown, callbacks: unknown): void {
      const loaderContext = context as FragmentLoaderContext;
      const url = resolveCacheableFragmentUrl(loaderContext);
      const entry = url ? cache.take(url) : null;
      if (!url || !entry) {
        this.delegate(context, config, callbacks);
        return;
      }

      this.activeContext = loaderContext;
      this.activeConfig = config;
      this.callbacks = callbacks as FragmentLoaderCallbacks;
      this.pendingUrl = url;
      this.pendingEntry = entry;
      this.stats.loading.start = performance.now();

      if (entry.complete) {
        this.timer = setTimeout(() => this.deliverCompleteEntry(entry), 0);
        return;
      }
      this.loadRemainder(loaderContext, config as FragmentLoaderConfig, entry);
    }

    abort(): void {
      if (this.delegated) {
        this.inner.abort?.();
        return;
      }
      const callbacks = this.callbacks;
      const context = this.activeContext;
      this.clearPending();
      if (!callbacks || !context || this.settled) return;
      this.restorePendingEntry();
      this.settled = true;
      this.stats.aborted = true;
      callbacks.onAbort?.(this.stats, context, null);
    }

    destroy(): void {
      if (!this.delegated && !this.settled) this.restorePendingEntry();
      this.clearPending();
      this.callbacks = null;
      this.activeContext = null;
      this.activeConfig = null;
      this.inner.destroy?.();
    }

    private delegate(context: unknown, config: unknown, callbacks: unknown) {
      this.delegated = true;
      this.inner.load(context, config, callbacks);
    }

    private clearPending(): void {
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      const controller = this.controller;
      this.controller = null;
      controller?.abort();
    }

    private restorePendingEntry(): void {
      const url = this.pendingUrl;
      const entry = this.pendingEntry;
      this.pendingUrl = null;
      this.pendingEntry = null;
      if (url && entry) cache.put(url, entry);
    }

    private deliverCompleteEntry(entry: FragmentMemoryEntry): void {
      this.timer = null;
      if (this.settled || !this.callbacks) return;
      const stats = this.stats;
      const end = Math.max(performance.now(), stats.loading.start);
      const transferMs = Math.max(1, entry.transferMs);
      stats.loading.end = end;
      stats.loading.first = end - transferMs;
      stats.loading.start = stats.loading.first - entry.ttfbMs;
      stats.loaded = stats.total = entry.data.byteLength;
      stats.bwEstimate = (stats.total * 8000) / transferMs;
      this.pendingEntry = null;
      this.succeed(toTransferableBuffer(entry.data), 200);
    }

    private loadRemainder(
      context: FragmentLoaderContext,
      config: FragmentLoaderConfig | null,
      entry: FragmentMemoryEntry,
    ): void {
      const fetcher =
        options.fetcher ?? (globalThis.fetch as FragmentFetcher | undefined);
      if (!fetcher) {
        this.fallbackToBaseLoader();
        return;
      }
      const controller = new AbortController();
      this.controller = controller;
      const policy = config?.loadPolicy;
      const firstByteTimeoutMs = resolvePositiveMs(
        policy?.maxTimeToFirstByteMs,
        config?.timeout,
      );
      const loadTimeoutMs = resolvePositiveMs(
        policy?.maxLoadTimeMs,
        config?.timeout,
      );
      this.timer = setTimeout(() => this.handleTimeout(), firstByteTimeoutMs);
      const isCurrent = () => this.controller === controller && !this.settled;

      const prefixBytes = entry.data.byteLength;
      fetcher(context.url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'same-origin',
        headers: { ...context.headers, Range: `bytes=${prefixBytes}-` },
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!isCurrent()) return;
          const stats = this.stats;
          stats.loading.first = Math.max(
            performance.now(),
            stats.loading.start,
          );
          if (this.timer !== null) clearTimeout(this.timer);
          this.timer = setTimeout(
            () => this.handleTimeout(),
            Math.max(
              0,
              loadTimeoutMs - (stats.loading.first - stats.loading.start),
            ),
          );
          if (response.status !== 206 && response.status !== 200) {
            this.fallbackToBaseLoader();
            return;
          }

          const body = new Uint8Array(await response.arrayBuffer());
          if (!isCurrent()) return;
          if (response.status === 200) {
            this.completeRemainderLoad(body, 0);
            return;
          }
          if (
            !isValidRemainder(
              entry,
              body.byteLength,
              response.headers?.get('content-range'),
            )
          ) {
            this.fallbackToBaseLoader();
            return;
          }
          const combined = new Uint8Array(prefixBytes + body.byteLength);
          combined.set(entry.data, 0);
          combined.set(body, prefixBytes);
          this.completeRemainderLoad(combined, entry.transferMs);
        })
        .catch(() => {
          if (isCurrent()) this.fallbackToBaseLoader();
        });
    }

    private completeRemainderLoad(
      data: Uint8Array,
      prefixTransferMs: number,
    ): void {
      this.clearPending();
      const stats = this.stats;
      // 把前缀当初的传输耗时并入本次请求，首字节耗时仍取本次真实值
      stats.loading.start -= prefixTransferMs;
      stats.loading.first -= prefixTransferMs;
      stats.loading.end = Math.max(performance.now(), stats.loading.first + 1);
      stats.loaded = stats.total = data.byteLength;
      stats.bwEstimate =
        (stats.total * 8000) / (stats.loading.end - stats.loading.first);
      this.pendingEntry = null;
      this.succeed(toTransferableBuffer(data), 200);
    }

    private handleTimeout(): void {
      this.timer = null;
      const callbacks = this.callbacks;
      const context = this.activeContext;
      if (this.settled || !callbacks || !context) return;
      this.clearPending();
      this.pendingEntry = null;
      this.settled = true;
      callbacks.onTimeout(this.stats, context, null);
    }

    private fallbackToBaseLoader(): void {
      const callbacks = this.callbacks;
      const context = this.activeContext;
      this.clearPending();
      this.pendingEntry = null;
      if (this.settled || !callbacks || !context) return;
      resetLoadStats(this.stats);
      this.delegate(context, this.activeConfig, callbacks);
    }

    private succeed(data: ArrayBuffer, code: number): void {
      const callbacks = this.callbacks;
      const context = this.activeContext;
      if (!callbacks || !context) return;
      this.settled = true;
      callbacks.onProgress?.(this.stats, context, data, null);
      if (!this.callbacks) return;
      callbacks.onSuccess(
        { url: context.url, data, code },
        this.stats,
        context,
        null,
      );
    }
  };
}

export const FragmentMemoryCacheLoader = withFragmentMemoryCache();
