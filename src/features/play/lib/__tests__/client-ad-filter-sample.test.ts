import * as fs from 'fs';
import * as path from 'path';

import { filterAdsFromM3U8 } from '@/features/play/lib/playUtils';

const FIXTURE_PATH = path.join(
  process.cwd(),
  'src',
  'features',
  'play',
  'lib',
  '__tests__',
  'fixtures',
  'ikun-gintama-episode-5.m3u8',
);

const CONTENT_PREFIX = 'https://kkzycdn.com:65/20221213/4GFb1YPb/2000kb/hls/';
const AD_PREFIX = 'https://kkzycdn.com:65/20260831/4XwXaAxc/10095kb/hls/';

function sumExtinf(manifest: string): number {
  return manifest
    .split('\n')
    .filter((line) => line.trim().startsWith('#EXTINF:'))
    .reduce((sum, line) => sum + (parseFloat(line.split(':')[1]) || 0), 0);
}

function countLines(manifest: string, predicate: (line: string) => boolean) {
  return manifest.split('\n').filter((line) => predicate(line.trim())).length;
}

describe('filterAdsFromM3U8 — ikun 银魂第5集真实清单', () => {
  const original = fs.readFileSync(FIXTURE_PATH, 'utf8');

  it('原始清单包含正片与广告两套资产目录', () => {
    expect(countLines(original, (l) => l.startsWith(CONTENT_PREFIX))).toBe(748);
    expect(countLines(original, (l) => l.startsWith(AD_PREFIX))).toBe(18);
    expect(countLines(original, (l) => l === '#EXT-X-DISCONTINUITY')).toBe(43);
  });

  const filtered = filterAdsFromM3U8(original);

  it('移除全部广告资产切片', () => {
    expect(countLines(filtered, (l) => l.startsWith(AD_PREFIX))).toBe(0);
  });

  it('完整保留正片切片', () => {
    expect(countLines(filtered, (l) => l.startsWith(CONTENT_PREFIX))).toBe(748);
  });

  it('保留正片之间的 DISCONTINUITY，避免 hls.js 不重置解封装器', () => {
    expect(
      countLines(filtered, (l) => l === '#EXT-X-DISCONTINUITY'),
    ).toBeGreaterThan(0);
  });

  it('保留 ENDLIST', () => {
    expect(countLines(filtered, (l) => l === '#EXT-X-ENDLIST')).toBe(1);
  });

  it('仅削减广告时长', () => {
    const removed = sumExtinf(original) - sumExtinf(filtered);
    expect(removed).toBeGreaterThan(50);
    expect(removed).toBeLessThan(60);
  });
});
