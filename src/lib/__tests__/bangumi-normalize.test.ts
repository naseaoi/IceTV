import { selectBangumiCardCover } from '../bangumi-normalize';

describe('selectBangumiCardCover', () => {
  it('uses the Bangumi cover proxy for large covers', () => {
    expect(
      selectBangumiCardCover({
        large: 'http://lain.bgm.tv/pic/cover/l/27/ff/377130_wDU1x.jpg',
        common: 'http://lain.bgm.tv/pic/cover/c/27/ff/377130_wDU1x.jpg',
        medium: 'http://lain.bgm.tv/pic/cover/m/27/ff/377130_wDU1x.jpg',
        small: 'http://lain.bgm.tv/pic/cover/s/27/ff/377130_wDU1x.jpg',
        grid: 'http://lain.bgm.tv/pic/cover/g/27/ff/377130_wDU1x.jpg',
      }),
    ).toBe('/api/bangumi-cover/l/27/ff/377130_wDU1x.jpg');
  });

  it('falls back to common when large is missing', () => {
    expect(
      selectBangumiCardCover({
        large: '',
        common: 'common.jpg',
        medium: 'medium.jpg',
        small: 'small.jpg',
        grid: 'grid.jpg',
      }),
    ).toBe('common.jpg');
  });
});
