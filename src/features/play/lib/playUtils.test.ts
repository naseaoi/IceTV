import { filterAdsFromM3U8 } from '@/features/play/lib/playUtils';

function createPlaylist(blocks: string[][]) {
  return ['#EXTM3U', '#EXT-X-VERSION:3', ...blocks.flat()].join('\n');
}

describe('filterAdsFromM3U8', () => {
  it('会移除夹在正片之间的短中插广告区间', () => {
    const input = createPlaylist([
      ['#EXTINF:270,', 'main-a-1.ts', '#EXTINF:280,', 'main-a-2.ts'],
      [
        '#EXT-X-DISCONTINUITY',
        '#EXTINF:10,',
        'mid-1.ts',
        '#EXTINF:10,',
        'mid-2.ts',
      ],
      ['#EXT-X-DISCONTINUITY', '#EXTINF:300,', 'main-b-1.ts'],
    ]);

    const output = filterAdsFromM3U8(input);

    expect(output).not.toContain('mid-1.ts');
    expect(output).not.toContain('mid-2.ts');
    expect(output).toContain('main-a-1.ts');
    expect(output).toContain('main-b-1.ts');
  });

  it('不会误删两侧都不够长的短中间区间', () => {
    const input = createPlaylist([
      ['#EXTINF:40,', 'part-a.ts'],
      [
        '#EXT-X-DISCONTINUITY',
        '#EXTINF:10,',
        'bridge-1.ts',
        '#EXTINF:10,',
        'bridge-2.ts',
      ],
      ['#EXT-X-DISCONTINUITY', '#EXTINF:50,', 'part-b.ts'],
    ]);

    const output = filterAdsFromM3U8(input);

    expect(output).toContain('bridge-1.ts');
    expect(output).toContain('bridge-2.ts');
  });

  it('仍然优先移除带广告特征 URL 的区间', () => {
    const input = createPlaylist([
      ['#EXTINF:180,', 'main-a.ts'],
      [
        '#EXT-X-DISCONTINUITY',
        '#EXTINF:15,',
        'midroll/ad-1.ts',
        '#EXTINF:15,',
        'midroll/ad-2.ts',
      ],
      ['#EXT-X-DISCONTINUITY', '#EXTINF:200,', 'main-b.ts'],
    ]);

    const output = filterAdsFromM3U8(input);

    expect(output).not.toContain('midroll/ad-1.ts');
    expect(output).not.toContain('midroll/ad-2.ts');
    expect(output).toContain('main-b.ts');
  });

  it('会移除粗粒度步进的中插广告区间', () => {
    const input = createPlaylist([
      ['#EXTINF:4.170833,', 'main-a-1.ts', '#EXTINF:3.628622,', 'main-a-2.ts'],
      ['#EXT-X-DISCONTINUITY', '#EXTINF:4.170833,', 'main-b-1.ts'],
      [
        '#EXT-X-DISCONTINUITY',
        '#EXTINF:4.000000,',
        'grid-ad-1.ts',
        '#EXTINF:5.480000,',
        'grid-ad-2.ts',
        '#EXTINF:4.000000,',
        'grid-ad-3.ts',
        '#EXTINF:3.240000,',
        'grid-ad-4.ts',
        '#EXTINF:4.000000,',
        'grid-ad-5.ts',
        '#EXTINF:0.280000,',
        'grid-ad-6.ts',
      ],
      ['#EXT-X-DISCONTINUITY', '#EXTINF:4.170833,', 'main-c-1.ts'],
      ['#EXT-X-DISCONTINUITY', '#EXTINF:5.130122,', 'main-d-1.ts'],
    ]);

    const output = filterAdsFromM3U8(input);

    expect(output).not.toContain('grid-ad-1.ts');
    expect(output).not.toContain('grid-ad-6.ts');
    expect(output).toContain('main-a-1.ts');
  });

  it('会移除正片后的连续短尾部广告区间并保留 ENDLIST', () => {
    const input = createPlaylist([
      ['#EXTINF:356,', 'main-a.ts'],
      ['#EXT-X-DISCONTINUITY', '#EXTINF:20,', 'mid-ad.ts'],
      ['#EXT-X-DISCONTINUITY', '#EXTINF:1320,', 'main-b.ts'],
      ['#EXT-X-DISCONTINUITY', '#EXTINF:19.633333,', 'tail-ad-a.ts'],
      ['#EXT-X-DISCONTINUITY', '#EXTINF:42.542000,', 'tail-ad-b.ts'],
      ['#EXT-X-ENDLIST'],
    ]);

    const output = filterAdsFromM3U8(input);

    expect(output).not.toContain('tail-ad-a.ts');
    expect(output).not.toContain('tail-ad-b.ts');
    expect(output).toContain('main-a.ts');
    expect(output).toContain('main-b.ts');
    expect(output.trim().endsWith('#EXT-X-ENDLIST')).toBe(true);
  });

  it('会移除 ikun 插在正片分块之间、换转码目录的整数时长广告', () => {
    const mainDurations = [2.085, 1.626, 2.085, 2.419, 1.751, 2.085, 1.501];
    const mainBlock = (block: number, count: number) => [
      ...(block === 0 ? [] : ['#EXT-X-DISCONTINUITY']),
      ...Array.from({ length: count }, (_, index) => [
        `#EXTINF:${mainDurations[index % mainDurations.length]},`,
        `https://cdn.example.com:65/20221213/4GFb1YPb/2000kb/hls/m${block}-${index}.ts`,
      ]).flat(),
    ];
    const adBlock = [
      '#EXT-X-DISCONTINUITY',
      ...[3, 3, 5, 3, 3, 0.64].flatMap((duration, index) => [
        `#EXTINF:${duration},`,
        `https://cdn.example.com:65/20261101/tkPlKg7b/10082kb/hls/ad${index}.ts`,
      ]),
    ];
    const input = createPlaylist([
      ...Array.from({ length: 4 }, (_, block) => mainBlock(block, 20)),
      mainBlock(4, 7),
      adBlock,
      mainBlock(5, 13),
      ...Array.from({ length: 4 }, (_, block) => mainBlock(block + 6, 20)),
      ['#EXT-X-ENDLIST'],
    ]);

    const output = filterAdsFromM3U8(input);

    expect(output).not.toContain('/10082kb/');
    expect(output).toContain('m4-6.ts');
    expect(output).toContain('m5-0.ts');
    expect(output.match(/\.ts$/gm)).toHaveLength(9 * 20);
  });
});
