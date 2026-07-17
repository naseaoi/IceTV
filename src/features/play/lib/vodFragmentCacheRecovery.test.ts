import {
  createVodFragmentCacheRecoveryLoader,
  shouldRecoverVodFragmentHttpCache,
} from '@/features/play/lib/vodFragmentCacheRecovery';

type LoadRequest = {
  callbacks: {
    onError?: (...args: unknown[]) => unknown;
    onSuccess?: (...args: unknown[]) => unknown;
    onTimeout?: (...args: unknown[]) => unknown;
  };
  context: {
    frag?: unknown;
    headers?: Record<string, string>;
    url?: string;
  };
};

function createLoaderHarness() {
  const requests: LoadRequest[] = [];
  class BaseLoader {
    constructor(_config: unknown) {}

    load(context: unknown, _config: unknown, callbacks: unknown) {
      requests.push({
        callbacks: callbacks as LoadRequest['callbacks'],
        context: context as LoadRequest['context'],
      });
    }
  }
  return { BaseLoader, requests };
}

function loadFragment(
  Loader: new (config: unknown) => { load: (...args: unknown[]) => void },
  url: string,
  headers?: Record<string, string>,
) {
  const callbacks = {
    onError: jest.fn(),
    onSuccess: jest.fn(),
    onTimeout: jest.fn(),
  };
  const context = { frag: {}, headers, url };
  new Loader({}).load(context, {}, callbacks);
  return { callbacks, context };
}

describe('VOD fragment cache recovery', () => {
  it('enables recovery only for xigua', () => {
    expect(shouldRecoverVodFragmentHttpCache('xigua')).toBe(true);
    expect(shouldRecoverVodFragmentHttpCache('other')).toBe(false);
  });

  it('keeps the first fragment request cacheable', () => {
    const { BaseLoader, requests } = createLoaderHarness();
    const Loader = createVodFragmentCacheRecoveryLoader(BaseLoader, 'xigua');

    loadFragment(Loader, 'https://xgct-video.bzcdn.net/video75.ts');

    expect(requests[0].context.headers).toBeUndefined();
  });

  it('bypasses cache only when retrying a failed fragment', () => {
    const { BaseLoader, requests } = createLoaderHarness();
    const Loader = createVodFragmentCacheRecoveryLoader(BaseLoader, 'xigua');
    const url = 'https://xgct-video.bzcdn.net/video75.ts';

    loadFragment(Loader, url);
    requests[0].callbacks.onTimeout?.();
    loadFragment(Loader, url, {
      Accept: '*/*',
      'cache-control': 'max-age=3600',
    });

    expect(requests[1].context.headers).toEqual({
      Accept: '*/*',
      'Cache-Control': 'no-cache, no-store',
    });
  });

  it('keeps unrelated fragments cacheable after a failure', () => {
    const { BaseLoader, requests } = createLoaderHarness();
    const Loader = createVodFragmentCacheRecoveryLoader(BaseLoader, 'xigua');

    loadFragment(Loader, 'https://xgct-video.bzcdn.net/video75.ts');
    requests[0].callbacks.onError?.();
    loadFragment(Loader, 'https://xgct-video.bzcdn.net/video76.ts');

    expect(requests[1].context.headers).toBeUndefined();
  });

  it('restores normal caching after the retry succeeds', () => {
    const { BaseLoader, requests } = createLoaderHarness();
    const Loader = createVodFragmentCacheRecoveryLoader(BaseLoader, 'xigua');
    const url = 'https://xgct-video.bzcdn.net/video75.ts';

    loadFragment(Loader, url);
    requests[0].callbacks.onError?.();
    loadFragment(Loader, url);
    requests[1].callbacks.onSuccess?.();
    loadFragment(Loader, url);

    expect(requests[1].context.headers).toEqual({
      'Cache-Control': 'no-cache, no-store',
    });
    expect(requests[2].context.headers).toBeUndefined();
  });

  it('does not alter manifests or other sources', () => {
    const { BaseLoader, requests } = createLoaderHarness();
    const XiguaLoader = createVodFragmentCacheRecoveryLoader(
      BaseLoader,
      'xigua',
    );
    const OtherLoader = createVodFragmentCacheRecoveryLoader(
      BaseLoader,
      'other',
    );

    new XiguaLoader({}).load(
      { url: 'https://xgct-video.bzcdn.net/video.m3u8' },
      {},
      {},
    );
    loadFragment(OtherLoader, 'https://example.com/video75.ts');

    expect(OtherLoader).toBe(BaseLoader);
    expect(requests[0].context.headers).toBeUndefined();
    expect(requests[1].context.headers).toBeUndefined();
  });
});
