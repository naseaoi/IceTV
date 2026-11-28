import {
  isGirigiriUrl,
  normalizeGirigiriHttpUrl,
  parseGirigiriPlaylists,
  parseGirigiriVariantId,
} from '@/lib/giri';

import { createGiriTrackingResponse } from './__fixtures__/giri-tracking';

describe('girigiri identity and URLs', () => {
  it('兼容原始与复合版本 id', () => {
    expect(parseGirigiriVariantId('123')).toEqual({
      videoId: '123',
      groupId: null,
    });
    expect(parseGirigiriVariantId('123__giri_2')).toEqual({
      videoId: '123',
      groupId: '2',
    });
  });

  it.each([
    ['https://anime.girigirilove.icu', true],
    ['https://ani.girigirilove.com', true],
    ['https://ana.girigirilove.com/01.mp4', true],
    ['https://akua.girigirilove.com/playlist.m3u8', true],
    ['https://other.example/?url=https://ani.girigirilove.com', false],
    ['https://fakegirigirilove.com', false],
    ['javascript://ani.girigirilove.com/', false],
    ['invalid', false],
  ])('仅按 HTTP(S) 主机名识别 %s', (url, expected) => {
    expect(isGirigiriUrl(url)).toBe(expected);
  });

  it.each([
    null,
    42,
    {},
    'javascript:alert(1)',
    'data:image/png;base64,abc',
    'https://',
    '/relative.mp4',
  ])('拒绝无效地址 %p', (value) => {
    expect(normalizeGirigiriHttpUrl(value)).toBe('');
  });

  it('图片相对路径与协议相对路径按图片域补齐', () => {
    expect(
      normalizeGirigiriHttpUrl(
        'upload/a.webp',
        'https://jpg.girigirilove.com/',
      ),
    ).toBe('https://jpg.girigirilove.com/upload/a.webp');
    expect(
      normalizeGirigiriHttpUrl(
        '//jpg.girigirilove.com/a.webp',
        'https://jpg.girigirilove.com/',
      ),
    ).toBe('https://jpg.girigirilove.com/a.webp');
  });
});

describe('parseGirigiriPlaylists', () => {
  it.each([8, 9])('保持原线路与剧集顺序，%i 集时分组标签稳定', (count) => {
    const { info } = createGiriTrackingResponse(count, count);
    const result = parseGirigiriPlaylists(
      info.vod_play_from,
      info.vod_play_url,
    );
    expect(result.episode_groups).toEqual([
      { label: '繁中', count },
      { label: '简中', count },
    ]);
    expect(result.episodes).toHaveLength(count * 2);
    expect(result.episodes[0]).toBe('https://ana.girigirilove.com/1/1.mp4');
    expect(result.episodes[count]).toBe('https://ana.girigirilove.com/2/1.mp4');
    expect(result.episodes_titles?.slice(0, 2)).toEqual(['01', '02']);
  });

  it('保留标题实体、重复地址与 URL 中的美元符号，单线路不创建分组', () => {
    const url = 'https://ana.girigirilove.com/1.mp4?value=a$b';
    expect(
      parseGirigiriPlaylists('cht', `前篇&amp;后篇$${url}#02$${url}`),
    ).toEqual({
      episodes: [url, url],
      episodes_titles: ['前篇&后篇', '02'],
      episode_groups: undefined,
    });
  });

  it('杜比与未知线路保留稳定名称，空线路保持后续标签对齐', () => {
    const result = parseGirigiriPlaylists(
      'cht$$$DB$$$1080P',
      '$$$01$https://ana.girigirilove.com/1.mp4$$$02$https://akua.girigirilove.com/playlist.m3u8',
    );
    expect(result.episode_groups).toEqual([
      { label: '杜比', count: 1 },
      { label: '1080P', count: 1 },
    ]);
  });

  it.each([
    [null, ''],
    ['cht', {}],
    ['cht$$$chs', '01$https://ana.girigirilove.com/1.mp4'],
    ['cht', '01$https://ana.girigirilove.com/1.mp4#02$javascript:alert(1)'],
    ['cht', '01$https://ana.girigirilove.com/1.mp4#02$https://'],
    ['cht', '01$https://ana.girigirilove.com/1.mp4#bad-entry'],
  ])('异常播放列表整体失败，避免跳过坏集使历史索引位移', (from, urls) => {
    expect(() => parseGirigiriPlaylists(from, urls)).toThrow('girigiri');
  });

  it('没有可播放剧集时明确失败', () => {
    expect(() => parseGirigiriPlaylists('cht', '')).toThrow('暂无可播放剧集');
  });
});
