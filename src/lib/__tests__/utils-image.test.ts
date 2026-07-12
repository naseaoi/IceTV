import { DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY } from '../douban-source';
import { processImageUrl } from '../utils';

describe('processImageUrl', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete window.RUNTIME_CONFIG;
  });

  it('routes Bangumi cover URLs through the local cover endpoint', () => {
    expect(processImageUrl('http://lain.bgm.tv/pic/cover/l/92/43/a.jpg')).toBe(
      '/api/bangumi-cover/l/92/43/a.jpg',
    );
  });

  it('routes ordinary remote image URLs through the server proxy', () => {
    expect(processImageUrl('http://example.com/a.jpg')).toBe(
      '/api/image-proxy?url=http%3A%2F%2Fexample.com%2Fa.jpg',
    );
  });

  it('keeps ordinary remote image URLs direct in browser mode', () => {
    expect(processImageUrl('https://example.com/a.jpg', 'browser')).toBe(
      'https://example.com/a.jpg',
    );
  });

  it('keeps local and unsupported image URLs unchanged', () => {
    expect(processImageUrl('/covers/a.jpg')).toBe('/covers/a.jpg');
    expect(processImageUrl('data:image/png;base64,abc')).toBe(
      'data:image/png;base64,abc',
    );
  });

  it('uses the shared douban image proxy helper for supported cdn values', () => {
    localStorage.setItem(
      DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY,
      'cmliussss-cdn-tencent',
    );

    expect(processImageUrl('https://img1.doubanio.com/view/photo/s.jpg')).toBe(
      'https://img.doubanio.cmliussss.net/view/photo/s.jpg',
    );
  });

  it('uses runtime douban image proxy defaults', () => {
    window.RUNTIME_CONFIG = {
      DOUBAN_IMAGE_PROXY_TYPE: 'cmliussss-cdn-ali',
    } as typeof window.RUNTIME_CONFIG;

    expect(processImageUrl('https://img2.doubanio.com/view/photo/s.jpg')).toBe(
      'https://img.doubanio.cmliussss.com/view/photo/s.jpg',
    );
  });

  it('keeps configured douban CDN URLs direct', () => {
    expect(
      processImageUrl(
        'https://img.doubanio.cmliussss.net/view/photo/s_ratio_poster/a.jpg',
      ),
    ).toBe(
      'https://img.doubanio.cmliussss.net/view/photo/s_ratio_poster/a.jpg',
    );
  });
});
