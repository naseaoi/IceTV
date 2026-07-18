import {
  type VodSegmentPrebufferPolicy,
  resolveVodSegmentPrebufferPolicy,
} from '@/features/play/lib/vodSourcePlaybackPolicy';

type VodSegmentFragment = {
  duration?: number;
  end?: number;
  start?: number;
  url?: string;
};

type VodSegmentPrebufferResponse = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  ok: boolean;
};

type VodSegmentFetcher = (
  url: string,
  init: RequestInit,
) => Promise<VodSegmentPrebufferResponse>;

type VodSegmentPrebufferInput = {
  fragments?: VodSegmentFragment[];
  levelHeight?: number;
};

type VodSegmentPrebufferOptions = {
  fetcher?: VodSegmentFetcher;
  getCurrentTime: () => number;
  isServerProxy: () => boolean;
  sourceKey: string;
};

export type VodSegmentPrebufferResult = {
  attempted: number;
  succeeded: number;
};

function isSupportedSegmentUrl(
  rawUrl: string,
  policy: VodSegmentPrebufferPolicy,
): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === 'https:' &&
      url.hostname === policy.segmentHostname &&
      url.pathname.toLowerCase().endsWith('.ts')
    );
  } catch {
    return false;
  }
}

function resolveFragmentEnd(fragment: VodSegmentFragment): number {
  if (Number.isFinite(fragment.end)) {
    return Number(fragment.end);
  }
  const start = Number.isFinite(fragment.start) ? Number(fragment.start) : 0;
  const duration = Number.isFinite(fragment.duration)
    ? Number(fragment.duration)
    : 0;
  return start + duration;
}

function selectPrebufferUrls(
  fragments: VodSegmentFragment[],
  currentTime: number,
  policy: VodSegmentPrebufferPolicy,
): string[] {
  const targetTime = Math.max(0, currentTime) + policy.lookaheadSeconds;
  const firstAheadIndex = fragments.findIndex(
    (fragment) => resolveFragmentEnd(fragment) > targetTime,
  );
  if (firstAheadIndex < 0) {
    return [];
  }

  const urls: string[] = [];
  const seen = new Set<string>();
  let selectedDuration = 0;
  for (
    let index = Math.max(3, firstAheadIndex);
    index < fragments.length &&
    urls.length < policy.maxFragments &&
    selectedDuration < policy.durationSeconds;
    index += 1
  ) {
    const fragment = fragments[index];
    const rawUrl = fragment?.url;
    if (
      typeof rawUrl !== 'string' ||
      seen.has(rawUrl) ||
      !isSupportedSegmentUrl(rawUrl, policy)
    ) {
      continue;
    }
    seen.add(rawUrl);
    urls.push(rawUrl);
    selectedDuration += Number.isFinite(fragment.duration)
      ? Math.max(0, Number(fragment.duration))
      : 0;
  }
  return urls;
}

export function createVodSegmentPrebufferController({
  fetcher = (url, init) => fetch(url, init),
  getCurrentTime,
  isServerProxy,
  sourceKey,
}: VodSegmentPrebufferOptions) {
  const policy = resolveVodSegmentPrebufferPolicy(sourceKey);
  let disposed = false;
  let fragments: VodSegmentFragment[] | null = null;
  let activeRequests = 0;
  let attempted = 0;
  let succeeded = 0;
  const attemptedUrls = new Set<string>();
  const queuedUrls: string[] = [];
  const idleResolvers: Array<(result: VodSegmentPrebufferResult) => void> = [];
  const abortController = new AbortController();

  const getResult = (): VodSegmentPrebufferResult => ({ attempted, succeeded });
  const resolveIdle = () => {
    if (activeRequests > 0 || queuedUrls.length > 0) return;
    const result = getResult();
    while (idleResolvers.length > 0) {
      idleResolvers.shift()?.(result);
    }
  };

  const pump = () => {
    if (disposed || isServerProxy()) {
      queuedUrls.length = 0;
      resolveIdle();
      return;
    }

    while (
      activeRequests < (policy?.concurrency ?? 0) &&
      queuedUrls.length > 0
    ) {
      const url = queuedUrls.shift();
      if (!url) break;
      activeRequests += 1;
      void (async () => {
        try {
          const response = await fetcher(url, {
            cache: 'default',
            credentials: 'omit',
            mode: 'cors',
            signal: abortController.signal,
          });
          if (!response.ok) return;
          await response.arrayBuffer();
          succeeded += 1;
        } catch {}
      })().finally(() => {
        activeRequests -= 1;
        pump();
        resolveIdle();
      });
    }
  };

  const schedule = (): boolean => {
    if (disposed || isServerProxy() || !fragments) {
      return false;
    }
    if (!policy) {
      return false;
    }
    const urls = selectPrebufferUrls(
      fragments,
      getCurrentTime(),
      policy,
    ).filter((url) => !attemptedUrls.has(url));
    if (urls.length === 0) {
      return false;
    }
    for (const url of urls) {
      attemptedUrls.add(url);
      queuedUrls.push(url);
      attempted += 1;
    }
    pump();
    return true;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    queuedUrls.length = 0;
    abortController.abort();
    resolveIdle();
  };

  const handleLevelLoaded = (input: VodSegmentPrebufferInput): boolean => {
    if (
      disposed ||
      !policy ||
      isServerProxy() ||
      input.levelHeight !== policy.height ||
      !Array.isArray(input.fragments)
    ) {
      return false;
    }
    fragments = input.fragments;
    return schedule();
  };

  const handlePlaybackProgress = (): boolean => schedule();

  const waitForIdle = (): Promise<VodSegmentPrebufferResult> => {
    if (activeRequests === 0 && queuedUrls.length === 0) {
      return Promise.resolve(getResult());
    }
    return new Promise((resolve) => idleResolvers.push(resolve));
  };

  return {
    dispose,
    handleLevelLoaded,
    handlePlaybackProgress,
    waitForIdle,
  };
}
