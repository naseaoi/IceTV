import {
  buildLazyEpisodeUrl,
  isLazyEpisodeUrl,
  parseLazyEpisodeUrl,
} from '@/lib/lazy-episodes';

describe('lazy-episodes', () => {
  it('构建并解析 giri 懒地址', () => {
    const url = buildLazyEpisodeUrl('giri', '/playGV25627-1-9/');

    expect(url).toBe('icetv-lazy://giri/playGV25627-1-9/');
    expect(isLazyEpisodeUrl(url)).toBe(true);
    expect(parseLazyEpisodeUrl(url)).toEqual({
      kind: 'giri',
      path: '/playGV25627-1-9/',
    });
  });

  it('构建并解析 xgcartoon 懒地址', () => {
    const url = buildLazyEpisodeUrl('xgcartoon', '/video/test-cartoon/c1.html');

    expect(isLazyEpisodeUrl(url)).toBe(true);
    expect(parseLazyEpisodeUrl(url)).toEqual({
      kind: 'xgcartoon',
      path: '/video/test-cartoon/c1.html',
    });
  });

  it('普通地址不识别为懒地址', () => {
    expect(isLazyEpisodeUrl('https://cdn.example/video.m3u8')).toBe(false);
    expect(parseLazyEpisodeUrl('https://cdn.example/video.m3u8')).toBeNull();
  });

  it('拒绝未知 kind 与非法路径', () => {
    expect(parseLazyEpisodeUrl('icetv-lazy://unknown/playGV1-1-1/')).toBeNull();
    expect(parseLazyEpisodeUrl('icetv-lazy://giri/playGV1-1-1')).toBeNull();
    expect(
      parseLazyEpisodeUrl('icetv-lazy://giri/playGV1-1-1/../admin'),
    ).toBeNull();
    expect(
      parseLazyEpisodeUrl('icetv-lazy://xgcartoon/video/a/b.php'),
    ).toBeNull();
    expect(
      parseLazyEpisodeUrl('icetv-lazy://xgcartoon/video/a/../b.html'),
    ).toBeNull();
    expect(parseLazyEpisodeUrl('icetv-lazy://giri')).toBeNull();
  });
});
