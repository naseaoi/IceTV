import {
  getBackFallbackPath,
  normalizeInternalReturnPath,
  withReturnTo,
} from '@/lib/navigation-return';

describe('navigation return', () => {
  it('保留站内路径的查询参数和锚点', () => {
    expect(normalizeInternalReturnPath('/search?q=凡人#results')).toBe(
      '/search?q=%E5%87%A1%E4%BA%BA#results',
    );
  });

  it.each([
    'https://example.com/path',
    '//example.com/path',
    '/\\example.com/path',
    '/play?title=test',
  ])('拒绝非法或循环返回路径 %s', (value) => {
    expect(normalizeInternalReturnPath(value, '/categories')).toBe(
      '/categories',
    );
  });

  it('为点播地址写入来源页面', () => {
    const target = withReturnTo('/play?source=test&id=1', '/douban?type=tv');
    const parsed = new URL(target, 'https://icetv.local');

    expect(parsed.pathname).toBe('/play');
    expect(parsed.searchParams.get('returnTo')).toBe('/douban?type=tv');
  });

  it('为直播地址写入完整来源页面', () => {
    const target = withReturnTo(
      '/live',
      '/search?q=%E6%96%B0%E9%97%BB#results',
    );
    const parsed = new URL(target, 'https://icetv.local');

    expect(parsed.pathname).toBe('/live');
    expect(parsed.searchParams.get('returnTo')).toBe(
      '/search?q=%E6%96%B0%E9%97%BB#results',
    );
  });

  it('为主要返回页面提供稳定回退', () => {
    expect(getBackFallbackPath('/play')).toBe('/');
    expect(getBackFallbackPath('/douban')).toBe('/categories');
    expect(getBackFallbackPath('/live')).toBe('/');
    expect(getBackFallbackPath('/me/favorites')).toBe('/me');
  });
});
