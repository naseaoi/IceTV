import { processImageUrl } from '../utils';

describe('processImageUrl', () => {
  beforeEach(() => {
    localStorage.clear();
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
});
