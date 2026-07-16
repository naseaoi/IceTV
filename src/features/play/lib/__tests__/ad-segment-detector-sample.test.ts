/**
 * 真实样本回归：用户报告链接 rycj/2000k/hls/index.m3u8，
 * 在 7:15-7:37 (435.77~457.77s) 有广告。
 *
 * 样本文件不入库（见 .gitignore 的 __fixtures__ 规则），原因是它含
 * 具体影片 ID 与 CDN 路径。本地需要回归时，把 m3u8 落到：
 *   src/lib/__tests__/__fixtures__/sample-rycj.m3u8.txt
 * fixture 不存在时整组测试自动 skip，不影响 CI。
 *
 * 广告段 seg#19 的 6 个 TS 名（从样本手工定位）：
 *   4.0s × 5 (ee6b... / 002c... / 5ee8... / e05e... / 3370...) + 2.0s (e31c...)
 */
import * as fs from 'fs';
import * as path from 'path';

import { stripAdSegmentsByPhysicalSignal } from '@/features/play/lib/ad-segment-detector';

const ORIGIN =
  'https://cdn.ryplay12.com/20250713/19853_cd5f3209/2000k/hls/index.m3u8';

const AD_TS_NAMES = [
  'ee6b555167f2205e06531936e579cc7e.ts',
  '002cdab0652e6bc2a4b3561d4d4a9ca2.ts',
  '5ee8d0158f05d4ef2648a869132b8f1d.ts',
  'e05e38a79ee064e3f1ff3932d42b70fc.ts',
  '33709e739e9fef0753e9fa6aac423393.ts',
  'e31ce9b7f0cb8de041d930f9eb53bf94.ts',
];

const FIXTURE_PATH = path.join(
  process.cwd(),
  'src',
  'lib',
  '__tests__',
  '__fixtures__',
  'sample-rycj.m3u8.txt',
);
const HAS_FIXTURE = fs.existsSync(FIXTURE_PATH);
const describeIfFixture = HAS_FIXTURE ? describe : describe.skip;

describeIfFixture('ad-segment-detector 真实样本回归', () => {
  test('识别并剔除 seg#19 广告段', async () => {
    const m3u8 = fs.readFileSync(FIXTURE_PATH, 'utf8');

    // 前置：样本确实含所有广告 TS
    for (const n of AD_TS_NAMES) expect(m3u8).toContain(n);

    const result = await stripAdSegmentsByPhysicalSignal(m3u8, ORIGIN, 'ua');

    // 广告 TS 全部剔除
    for (const n of AD_TS_NAMES) expect(result).not.toContain(n);

    // 正片 TS 未被误伤（抽样若干）
    expect(result).toContain('a176f1486fcb090d0720af7a8f8012b6.ts');
    expect(result).toContain('9dc5f5e8cc1e374a5575bf65803f56f6.ts');
    expect(result).toContain('81746c96387468a58f0a2104bbf364e4.ts');
    expect(result).not.toContain('#EXT-X-DISCONTINUITY');
  });
});
