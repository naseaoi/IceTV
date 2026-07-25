import * as fs from 'fs';
import * as path from 'path';

import { stripAdSegmentsByPhysicalSignal } from '@/features/play/lib/ad-segment-detector';

const ORIGIN = 'https://cdn.ryplay.example/rycj/episode-8/2000k/hls/index.m3u8';

const FIXTURE_PATH = path.join(
  process.cwd(),
  'src',
  'features',
  'play',
  'lib',
  '__tests__',
  'fixtures',
  'rycj-episode-8.m3u8',
);

function sumExtinfDurations(content: string): number {
  return Array.from(content.matchAll(/^#EXTINF:([\d.]+),/gm)).reduce(
    (total, match) => total + Number.parseFloat(match[1]),
    0,
  );
}

describe('ad-segment-detector rycj 源站样本回归', () => {
  test('删除等长广告并保留全部正片和片尾分片', async () => {
    const m3u8 = fs.readFileSync(FIXTURE_PATH, 'utf8');
    const result = await stripAdSegmentsByPhysicalSignal(m3u8, ORIGIN, 'ua');

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
});
