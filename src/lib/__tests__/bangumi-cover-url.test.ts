import {
  getBangumiCoverTargetUrl,
  toBangumiCoverProxyUrl,
} from '../bangumi-cover-url';

describe('toBangumiCoverProxyUrl', () => {
  it('maps Bangumi cover URLs to the local cover route', () => {
    expect(
      toBangumiCoverProxyUrl(
        'http://lain.bgm.tv/pic/cover/l/27/ff/377130_wDU1x.jpg',
      ),
    ).toBe('/api/bangumi-cover/l/27/ff/377130_wDU1x.jpg');
  });

  it('rejects non-Bangumi and malformed cover URLs', () => {
    expect(
      toBangumiCoverProxyUrl(
        'https://example.com/pic/cover/l/27/ff/377130_wDU1x.jpg',
      ),
    ).toBe('');
    expect(
      toBangumiCoverProxyUrl('https://lain.bgm.tv/pic/avatar/l/27/ff/a.jpg'),
    ).toBe('');
  });
});

describe('getBangumiCoverTargetUrl', () => {
  it('builds the upstream Bangumi cover URL from route segments', () => {
    expect(
      getBangumiCoverTargetUrl([
        'l',
        '27',
        'ff',
        '377130_wDU1x.jpg',
      ])?.toString(),
    ).toBe('https://lain.bgm.tv/pic/cover/l/27/ff/377130_wDU1x.jpg');
  });

  it('rejects invalid route segments', () => {
    expect(getBangumiCoverTargetUrl(['large', '27', 'ff', 'a.jpg'])).toBeNull();
    expect(
      getBangumiCoverTargetUrl(['l', '27', 'ff', '..%2Fsecret.jpg']),
    ).toBeNull();
  });
});
