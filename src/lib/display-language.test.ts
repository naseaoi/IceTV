import {
  DISPLAY_LANGUAGE_COOKIE,
  getDisplayLanguagePreference,
  getDocumentDisplayLanguage,
  parseDisplayLanguagePreference,
  resolveDisplayLanguage,
  setDisplayLanguagePreference,
  watchDisplayLanguagePreference,
} from './display-language';

afterEach(() => {
  document.cookie = `${DISPLAY_LANGUAGE_COOKIE}=; Max-Age=0; Path=/`;
  document.documentElement.lang = '';
});

describe('display language resolution', () => {
  it.each([
    ['zh-TW', 'zh-CN', 'zh-TW'],
    ['zh-HK', 'zh-TW', 'zh-HK'],
    ['zh-CN', 'zh-TW', 'zh-CN'],
    [undefined, 'zh-TW,zh;q=0.8', 'zh-TW'],
    ['auto', 'zh-Hant', 'zh-TW'],
    ['auto', 'zh-Hant-TW', 'zh-TW'],
    ['auto', 'zh-HK', 'zh-HK'],
    ['auto', 'zh-MO', 'zh-HK'],
    ['auto', 'zh-Hant-HK', 'zh-HK'],
    ['bad', 'en;q=0.5, zh-TW;q=0.9', 'zh-TW'],
    ['auto', 'en-US,zh-TW;q=0.5', 'zh-CN'],
    ['auto', 'zh-TW;q=0,zh-HK;q=0.8', 'zh-HK'],
    ['auto', 'zh-TW;q=bad,zh-HK;q=2', 'zh-CN'],
    [undefined, null, 'zh-CN'],
  ])('resolves %s with %s to %s', (preference, header, expected) => {
    expect(resolveDisplayLanguage(preference, header)).toBe(expected);
  });

  it('normalizes external preferences and reads only the designated cookie', () => {
    expect(parseDisplayLanguagePreference('<script>')).toBe('auto');
    document.cookie = `${DISPLAY_LANGUAGE_COOKIE}=zh-HK; Path=/`;
    expect(getDisplayLanguagePreference()).toBe('zh-HK');
    document.documentElement.lang = 'zh-TW';
    expect(getDocumentDisplayLanguage()).toBe('zh-TW');
  });

  it('writes a shared path cookie and refreshes the whole document', async () => {
    const original = window.location;
    const reload = jest.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { protocol: 'http:', reload },
    });
    try {
      await setDisplayLanguagePreference('zh-HK');
      expect(getDisplayLanguagePreference()).toBe('zh-HK');
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: original,
      });
    }
  });
});

describe('page caches and cross-tab synchronization', () => {
  const originalLocation = window.location;
  const reload = jest.fn();
  const deleteCache = jest.fn();
  let stop: (() => void) | undefined;
  beforeEach(() => {
    reload.mockReset();
    deleteCache.mockReset().mockResolvedValue(true);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { protocol: 'https:', reload },
    });
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: { delete: deleteCache },
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    Reflect.deleteProperty(globalThis, 'caches');
    Reflect.deleteProperty(document, 'visibilityState');
  });
  const settle = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  it('waits for page cache deletion and preserves non-page caches', async () => {
    let finish!: (value: boolean) => void;
    deleteCache.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const changed = setDisplayLanguagePreference('zh-TW');
    expect(reload).not.toHaveBeenCalled();
    expect(deleteCache.mock.calls.map(([name]) => name)).toEqual([
      'pages',
      'pages-rsc',
      'pages-rsc-prefetch',
      'next-data',
    ]);
    finish(true);
    await changed;
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('refreshes even if CacheStorage rejects deletion or access throws', async () => {
    deleteCache.mockRejectedValue(new Error('denied'));
    await setDisplayLanguagePreference('zh-TW');
    expect(reload).toHaveBeenCalledTimes(1);
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      get: () => {
        throw new Error('denied');
      },
    });
    await setDisplayLanguagePreference('zh-HK');
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it('defers a changed cookie until visible and refreshes once on BFCache pageshow', async () => {
    document.cookie = 'display_language=zh-TW; Path=/';
    stop = watchDisplayLanguagePreference('zh-TW');
    document.cookie = 'display_language=zh-HK; Path=/';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true }),
    );
    await settle();
    expect(reload).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true }),
    );
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('compares raw preferences and stops observing on cleanup', async () => {
    document.cookie = 'display_language=invalid-old; Path=/';
    stop = watchDisplayLanguagePreference('invalid-old');
    document.cookie = 'display_language=auto; Path=/';
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
    reload.mockClear();
    window.dispatchEvent(new Event('pageshow'));
    await settle();
    expect(reload).not.toHaveBeenCalled();
  });
  it('keeps a document hidden during cache deletion from interrupting background playback', async () => {
    let finish!: (value: boolean) => void;
    deleteCache.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    document.cookie = 'display_language=zh-HK; Path=/';
    stop = watchDisplayLanguagePreference('zh-TW');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    finish(true);
    await settle();
    expect(reload).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
