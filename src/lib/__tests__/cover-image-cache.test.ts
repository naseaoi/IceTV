import type * as CoverImageCache from '../cover-image-cache';

function loadCacheModule(): typeof CoverImageCache {
  return require('../cover-image-cache') as typeof CoverImageCache;
}

describe('cover image cache', () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.resetModules();
  });

  it('stores raw and processed image keys together', () => {
    const { isCoverImageCached, markCoverImagesLoaded } = loadCacheModule();

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
  });

  it('hydrates loaded image keys from session storage', () => {
    const { markCoverImagesLoaded } = loadCacheModule();

    markCoverImagesLoaded(['https://lain.bgm.tv/pic/cover.jpg']);
    jest.resetModules();

    const { isCoverImageCached } = loadCacheModule();

    expect(isCoverImageCached(['https://lain.bgm.tv/pic/cover.jpg'])).toBe(
      true,
    );
  });

  it('notifies subscribers when a watched key is loaded', () => {
    const { markCoverImagesLoaded, subscribeCoverImageLoaded } =
      loadCacheModule();
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
    unsubscribe();
  });
});
