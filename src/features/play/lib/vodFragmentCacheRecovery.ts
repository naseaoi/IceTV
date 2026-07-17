type HlsLoaderInstance = {
  load: (...args: unknown[]) => void;
};

export type HlsLoaderConstructor = new (config: unknown) => HlsLoaderInstance;

type FragmentLoaderContext = {
  frag?: unknown;
  headers?: Record<string, string>;
  url?: string;
};

type FragmentLoaderCallbacks = {
  onError?: (...args: unknown[]) => unknown;
  onSuccess?: (...args: unknown[]) => unknown;
  onTimeout?: (...args: unknown[]) => unknown;
};

const CACHE_BYPASS_HEADER_VALUE = 'no-cache, no-store';
const MAX_TRACKED_FAILED_FRAGMENT_URLS = 64;
const MAX_FRAGMENT_URL_LENGTH = 8_192;

function resolveFragmentUrl(context: FragmentLoaderContext): string | null {
  if (
    !context.frag ||
    typeof context.url !== 'string' ||
    context.url.length === 0 ||
    context.url.length > MAX_FRAGMENT_URL_LENGTH
  ) {
    return null;
  }
  return context.url;
}

function applyCacheBypassHeader(context: FragmentLoaderContext): void {
  const headers = { ...context.headers };
  for (const headerName of Object.keys(headers)) {
    if (headerName.toLowerCase() === 'cache-control') {
      delete headers[headerName];
    }
  }
  headers['Cache-Control'] = CACHE_BYPASS_HEADER_VALUE;
  context.headers = headers;
}

export function shouldRecoverVodFragmentHttpCache(sourceKey: string): boolean {
  return sourceKey === 'xigua';
}

export function createVodFragmentCacheRecoveryLoader(
  BaseLoader: HlsLoaderConstructor,
  sourceKey: string,
): HlsLoaderConstructor {
  if (!shouldRecoverVodFragmentHttpCache(sourceKey)) {
    return BaseLoader;
  }

  const failedFragmentUrls = new Set<string>();
  const rememberFailure = (url: string) => {
    failedFragmentUrls.delete(url);
    failedFragmentUrls.add(url);
    while (failedFragmentUrls.size > MAX_TRACKED_FAILED_FRAGMENT_URLS) {
      const oldestUrl = failedFragmentUrls.values().next().value;
      if (typeof oldestUrl !== 'string') break;
      failedFragmentUrls.delete(oldestUrl);
    }
  };

  return class extends BaseLoader {
    constructor(config: unknown) {
      super(config);

      const load = this.load.bind(this);
      this.load = function (
        context: unknown,
        loadConfig: unknown,
        callbacks: unknown,
      ) {
        const loaderContext = context as FragmentLoaderContext;
        const fragmentUrl = resolveFragmentUrl(loaderContext);
        if (!fragmentUrl) {
          load(context, loadConfig, callbacks);
          return;
        }

        if (failedFragmentUrls.has(fragmentUrl)) {
          applyCacheBypassHeader(loaderContext);
        }

        const loaderCallbacks = callbacks as FragmentLoaderCallbacks;
        const nextCallbacks: FragmentLoaderCallbacks = {
          ...loaderCallbacks,
          onError: (...args: unknown[]) => {
            rememberFailure(fragmentUrl);
            return loaderCallbacks.onError?.(...args);
          },
          onSuccess: (...args: unknown[]) => {
            failedFragmentUrls.delete(fragmentUrl);
            return loaderCallbacks.onSuccess?.(...args);
          },
          onTimeout: (...args: unknown[]) => {
            rememberFailure(fragmentUrl);
            return loaderCallbacks.onTimeout?.(...args);
          },
        };

        load(loaderContext, loadConfig, nextCallbacks);
      };
    }
  };
}
