import * as fs from 'fs';
import * as path from 'path';

import { filterM3U8AdsForSource } from '@/features/play/lib/ad-segment-detector';

const ORIGIN = 'https://cdn.ryplay.example/rycj/episode-8/2000k/hls/index.m3u8';

function fixturePath(name: string): string {
  return path.join(
    process.cwd(),
    'src',
    'features',
    'play',
    'lib',
    '__tests__',
    'fixtures',
    name,
  );
}

function sumExtinfDurations(content: string): number {
  return Array.from(content.matchAll(/^#EXTINF:([\d.]+),/gm)).reduce(
    (total, match) => total + Number.parseFloat(match[1]),
    0,
  );
}

describe('ad-segment-detector rycj 源站样本回归', () => {
  test('删除等长广告并保留全部正片和片尾分片', async () => {
    const m3u8 = fs.readFileSync(fixturePath('rycj-episode-8.m3u8'), 'utf8');
    const result = await filterM3U8AdsForSource(m3u8, ORIGIN, 'rycj');

    expect(m3u8.match(/ad_\d+\.ts/g)).toHaveLength(5);
    expect(result).not.toMatch(/ad_\d+\.ts/);
    expect(result.match(/content_\d+_\d+\.ts/g)).toHaveLength(40);

    for (let segment = 0; segment < 8; segment += 1) {
      for (let fragment = 0; fragment < 5; fragment += 1) {
        expect(result).toContain(`content_${segment}_${fragment}.ts`);
      }
    }

    expect(result).toContain('#EXTINF:0.834222,\ncontent_7_4.ts');
    expect(sumExtinfDurations(m3u8) - sumExtinfDurations(result)).toBeCloseTo(
      20,
      6,
    );
    expect(result).not.toContain('#EXT-X-DISCONTINUITY');
  });

  test('删除片尾 25fps 网格广告并保留最后一段正片', async () => {
    const m3u8 = fs.readFileSync(fixturePath('rycj-episode-12.m3u8'), 'utf8');
    const result = await filterM3U8AdsForSource(
      m3u8,
      ORIGIN.replace('episode-8', 'episode-12'),
      'rycj',
    );

    expect(m3u8.match(/tail_ad_\d+\.ts/g)).toHaveLength(3);
    expect(result).not.toMatch(/(mid|tail)_ad_\d+\.ts/);
    expect(result.match(/content_\d+_\d+\.ts/g)).toHaveLength(
      m3u8.match(/content_\d+_\d+\.ts/g)!.length,
    );
    expect(result).toContain(
      '#EXTINF:1.126200,\ncontent_72_3.ts\n#EXT-X-ENDLIST',
    );
    expect(sumExtinfDurations(m3u8) - sumExtinfDurations(result)).toBeCloseTo(
      33.16,
      6,
    );
    expect(result).not.toContain('#EXT-X-DISCONTINUITY');
  });

  test('25fps 正片只删已知广告模板，保留整秒切片的正片与片尾字幕', () => {
    const m3u8 = fs.readFileSync(
      fixturePath('rycj-episode-1-25fps.m3u8'),
      'utf8',
    );
    const result = filterM3U8AdsForSource(
      m3u8,
      ORIGIN.replace('episode-8', 'episode-1'),
      'rycj',
    );

    expect(m3u8.match(/(mid|tail)_ad_\d+\.ts/g)).toHaveLength(8);
    expect(result).not.toMatch(/(mid|tail)_ad_\d+\.ts/);
    expect(result.match(/content_\d+_\d+\.ts/g)).toHaveLength(
      m3u8.match(/content_\d+_\d+\.ts/g)!.length,
    );
    expect(result).not.toContain('#EXT-X-DISCONTINUITY');
  });

  test('块时长离散时删除中插与片尾网格广告，保留 23.976fps 整帧正片', () => {
    const m3u8 = fs.readFileSync(
      fixturePath('rycj-episode-11-irregular-blocks.m3u8'),
      'utf8',
    );
    const result = filterM3U8AdsForSource(
      m3u8,
      ORIGIN.replace('episode-8', 'episode-11'),
      'rycj',
    );

    expect(m3u8.match(/(mid|tail)_ad_\d+\.ts/g)).toHaveLength(8);
    expect(result).not.toMatch(/(mid|tail)_ad_\d+\.ts/);
    expect(result.match(/content_\d+_\d+\.ts/g)).toHaveLength(
      m3u8.match(/content_\d+_\d+\.ts/g)!.length,
    );
    expect(result).toContain('#EXTINF:4.004000,\ncontent_22_0.ts');
    expect(sumExtinfDurations(m3u8) - sumExtinfDurations(result)).toBeCloseTo(
      32.04,
      6,
    );
    expect(result).not.toContain('#EXT-X-DISCONTINUITY');
  });
});
