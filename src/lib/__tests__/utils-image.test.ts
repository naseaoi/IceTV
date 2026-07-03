import { processImageUrl } from '../utils';
import { DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY } from '../douban-source';

describe('processImageUrl', () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.RUNTIME_CONFIG;
  });

  it('keeps Bangumi cover URLs direct', () => {
    expect(processImageUrl('http://lain.bgm.tv/pic/cover/l/92/43/a.jpg')).toBe(
      'http://lain.bgm.tv/pic/cover/l/92/43/a.jpg',
    );
  });

  it('keeps non-Bangumi non-Douban image URLs unchanged', () => {
    expect(processImageUrl('http://example.com/a.jpg')).toBe(
      'http://example.com/a.jpg',
    );
  });

  it('uses the shared douban image proxy helper for img3', () => {
    localStorage.setItem(DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY, 'img3');

    expect(processImageUrl('https://img1.doubanio.com/view/photo/s.jpg')).toBe(
      'https://img3.doubanio.com/view/photo/s.jpg',
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
});
