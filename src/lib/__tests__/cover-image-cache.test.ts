import type * as CoverImageCache from '../cover-image-cache';

function loadCacheModule(): typeof CoverImageCache {
  return require('../cover-image-cache') as typeof CoverImageCache;
}

describe('cover image cache', () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores raw and processed image keys together', () => {
    const {
      flushCoverImageCacheForTests,
      isCoverImageCached,
      markCoverImagesLoaded,
    } = loadCacheModule();

    markCoverImagesLoaded([
      'https://img1.doubanio.com/view/photo/a.jpg',
      'https://img.doubanio.cmliussss.net/view/photo/a.jpg',
    ]);

    expect(
      isCoverImageCached(['https://img1.doubanio.com/view/photo/a.jpg']),
    ).toBe(true);
    expect(
      isCoverImageCached([
        'https://img.doubanio.cmliussss.net/view/photo/a.jpg',
      ]),
    ).toBe(true);
    flushCoverImageCacheForTests();
  });

  it('hydrates loaded image keys from session storage', () => {
    const { flushCoverImageCacheForTests, markCoverImagesLoaded } =
      loadCacheModule();

    markCoverImagesLoaded(['https://lain.bgm.tv/pic/cover.jpg']);
    flushCoverImageCacheForTests();
    jest.resetModules();

    const { isCoverImageCached } = loadCacheModule();

    expect(isCoverImageCached(['https://lain.bgm.tv/pic/cover.jpg'])).toBe(
      true,
    );
  });

  it('notifies subscribers when a watched key is loaded', () => {
    const {
      flushCoverImageCacheForTests,
      markCoverImagesLoaded,
      subscribeCoverImageLoaded,
    } = loadCacheModule();
    const onLoaded = jest.fn();
    const unsubscribe = subscribeCoverImageLoaded(
      ['https://img.doubanio.cmliussss.net/view/photo/a.jpg'],
      onLoaded,
    );

    markCoverImagesLoaded([
      'https://img1.doubanio.com/view/photo/a.jpg',
      'https://img.doubanio.cmliussss.net/view/photo/a.jpg',
    ]);

    expect(onLoaded).toHaveBeenCalledTimes(1);
    flushCoverImageCacheForTests();
    unsubscribe();
  });

  it('does not persist cache hits during render reads', () => {
    const { flushCoverImageCacheForTests, isCoverImageCached } =
      loadCacheModule();

    sessionStorage.setItem(
      'icetv:cover-image-loaded',
      JSON.stringify([['https://img.example/a.jpg', Date.now()]]),
    );

    expect(
      isCoverImageCached([
        'https://img.example/a.jpg',
        'https://img.example/a-processed.jpg',
      ]),
    ).toBe(true);

    const raw = sessionStorage.getItem('icetv:cover-image-loaded') || '';
    expect(raw).not.toContain('a-processed');
    flushCoverImageCacheForTests();
  });

  it('persists failed image keys for the current session', () => {
    const {
      flushCoverImageCacheForTests,
      isCoverImageFailed,
      markCoverImagesFailed,
    } = loadCacheModule();
    const src = 'https://covers.example.com/missing.jpg';

    markCoverImagesFailed([src]);
    expect(isCoverImageFailed([src])).toBe(true);
    flushCoverImageCacheForTests();
    jest.resetModules();

    expect(loadCacheModule().isCoverImageFailed([src])).toBe(true);
  });

  it('expires failed image keys after ten minutes', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-18T00:00:00Z'));
    const {
      COVER_IMAGE_FAILURE_TTL_MS,
      isCoverImageFailed,
      markCoverImagesFailed,
    } = loadCacheModule();
    const src = 'https://covers.example.com/transient.jpg';

    markCoverImagesFailed([src]);
    jest.advanceTimersByTime(COVER_IMAGE_FAILURE_TTL_MS - 1);
    expect(isCoverImageFailed([src])).toBe(true);

    jest.advanceTimersByTime(1);
    expect(isCoverImageFailed([src])).toBe(false);
    loadCacheModule().clearCoverImageCacheForTests();
  });

  it('clears a failed key after the image loads successfully', () => {
    const {
      isCoverImageCached,
      isCoverImageFailed,
      markCoverImagesFailed,
      markCoverImagesLoaded,
    } = loadCacheModule();
    const src = 'https://covers.example.com/recovered.jpg';

    markCoverImagesFailed([src]);
    markCoverImagesLoaded([src]);

    expect(isCoverImageFailed([src])).toBe(false);
    expect(isCoverImageCached([src])).toBe(true);
    loadCacheModule().clearCoverImageCacheForTests();
  });
});
