import {
  buildCoverImageVariantUrl,
  supportsCoverImageVariants,
} from '../cover-image-variants';

describe('cover image variants', () => {
  it('adds the selected width and quality to proxy URLs', () => {
    expect(
      buildCoverImageVariantUrl({
        src: '/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fcover.jpg',
        width: 256,
        quality: 60,
      }),
    ).toBe(
      '/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fcover.jpg&width=256&quality=60',
    );
  });

  it('selects native Douban CDN tiers without changing the host', () => {
    expect(
      buildCoverImageVariantUrl({
        src: 'https://img.doubanio.cmliussss.net/view/photo/l_ratio_poster/public/a.jpg',
        width: 256,
        quality: 72,
      }),
    ).toBe(
      'https://img.doubanio.cmliussss.net/view/photo/s_ratio_poster/public/a.jpg',
    );
    expect(
      buildCoverImageVariantUrl({
        src: 'https://img1.doubanio.com/view/photo/s_ratio_poster/public/a.jpg',
        width: 384,
        quality: 72,
      }),
    ).toBe('https://img1.doubanio.com/view/photo/m_ratio_poster/public/a.jpg');
  });

  it('only enables variants for the local proxy and native Douban URLs', () => {
    expect(
      supportsCoverImageVariants(
        '/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fa.jpg',
      ),
    ).toBe(true);
    expect(
      supportsCoverImageVariants(
        'https://img.doubanio.cmliussss.net/view/photo/s_ratio_poster/public/a.jpg',
      ),
    ).toBe(true);
    expect(supportsCoverImageVariants('https://covers.example.com/a.jpg')).toBe(
      false,
    );
    expect(supportsCoverImageVariants('/api/bangumi-cover/l/a/b/c.jpg')).toBe(
      false,
    );
  });
});
