import {
  parseEpgXmlForChannels,
  parseLivePlaylist,
} from '@/features/live/lib/live';

describe('parseLivePlaylist', () => {
  it('解析文本 IPTV 分组清单', () => {
    const result = parseLivePlaylist(
      'iptv',
      [
        '央视频道,#genre#',
        'CCTV-1 综合,http://example.test/cctv1.m3u8',
        '卫视频道,#genre#',
        '湖南卫视,http://example.test/hunan.m3u8',
      ].join('\n'),
    );

    expect(result.tvgUrl).toBe('');
    expect(result.channels).toEqual([
      {
        id: 'iptv-0',
        tvgId: 'CCTV-1 综合',
        name: 'CCTV-1 综合',
        logo: '',
        group: '央视频道',
        url: 'http://example.test/cctv1.m3u8',
      },
      {
        id: 'iptv-1',
        tvgId: '湖南卫视',
        name: '湖南卫视',
        logo: '',
        group: '卫视频道',
        url: 'http://example.test/hunan.m3u8',
      },
    ]);
  });

  it('保留标准 M3U 解析', () => {
    const result = parseLivePlaylist(
      'm3u',
      [
        '#EXTM3U x-tvg-url="https://example.test/epg.xml"',
        '#EXTINF:-1 tvg-id="cctv1" tvg-name="CCTV1" tvg-logo="https://example.test/logo.png" group-title="央视",CCTV-1',
        'https://example.test/cctv1.m3u8',
      ].join('\n'),
    );

    expect(result.tvgUrl).toBe('https://example.test/epg.xml');
    expect(result.channels).toEqual([
      {
        id: 'm3u-0',
        tvgId: 'cctv1',
        name: 'CCTV-1',
        logo: 'https://example.test/logo.png',
        group: '央视',
        url: 'https://example.test/cctv1.m3u8',
      },
    ]);
  });
});

describe('parseEpgXmlForChannels', () => {
  it('通过 display-name 匹配第三方 EPG 频道', () => {
    const result = parseEpgXmlForChannels(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<tv>',
        '<channel id="1">',
        '<display-name lang="zh">CCTV1</display-name>',
        '</channel>',
        '<programme start="20260627000000 +0800" stop="20260627003000 +0800" channel="1">',
        '<title lang="zh">新闻联播</title>',
        '</programme>',
        '</tv>',
      ].join('\n'),
      [
        { tvgId: 'CCTV1.cn@HD', name: 'CCTV-1 (1080p)' },
        { tvgId: '', name: 'CCTV1' },
      ],
    );

    expect(result['CCTV1.cn@HD']).toEqual([
      {
        start: '20260627000000 +0800',
        end: '20260627003000 +0800',
        title: '新闻联播',
      },
    ]);
    expect(result['CCTV-1 (1080p)']).toEqual(result['CCTV1.cn@HD']);
    expect(result.CCTV1).toEqual(result['CCTV1.cn@HD']);
  });
});
