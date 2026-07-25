/**
 * 广告段识别纯函数的单测。
 * 覆盖本地强信号（EXTINF 整数规律、Host 异常）与兜底短路路径。
 * 网络相关的码率兜底路径不在此测试范围内（需 fetch stub）。
 */
import {
  filterM3U8AdsForSource,
  shouldRunAdDetection,
  stripAdSegmentsByPhysicalSignal,
} from '@/features/play/lib/ad-segment-detector';

describe('shouldRunAdDetection', () => {
  test('仅对 rycj 源站启用', () => {
    expect(shouldRunAdDetection('rycj')).toBe(true);
    expect(shouldRunAdDetection('other')).toBe(false);
    expect(shouldRunAdDetection(null)).toBe(false);
    expect(shouldRunAdDetection('')).toBe(false);
  });
});

describe('filterM3U8AdsForSource', () => {
  test('不同源站策略相互隔离', async () => {
    const lines = ['#EXTM3U', '#EXT-X-TARGETDURATION:5'];
    for (let segment = 0; segment < 8; segment += 1) {
      lines.push('#EXT-X-DISCONTINUITY');
      for (let fragment = 0; fragment < 6; fragment += 1) {
        lines.push('#EXTINF:5.000000,');
        lines.push(`main_${segment}_${fragment}.ts`);
      }
    }
    lines.push('#EXT-X-ENDLIST');
    const m3u8 = lines.join('\n');

    const [rycjResult, otherResult] = await Promise.all([
      filterM3U8AdsForSource(
        m3u8,
        'https://cdn.example.com/index.m3u8',
        'ua',
        'rycj',
      ),
      filterM3U8AdsForSource(
        m3u8,
        'https://cdn.example.com/index.m3u8',
        'ua',
        'other',
      ),
    ]);

    expect(rycjResult).not.toContain('#EXT-X-DISCONTINUITY');
    expect(otherResult).toBe(m3u8);
  });
});

describe('stripAdSegmentsByPhysicalSignal', () => {
  test('不含 DISCONTINUITY 时原样返回', async () => {
    const m3u8 = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXTINF:5,',
      'a.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const result = await stripAdSegmentsByPhysicalSignal(
      m3u8,
      'https://cdn.example.com/x/index.m3u8',
      'ua',
    );
    expect(result).toBe(m3u8);
  });

  test('段数不足时原样返回', async () => {
    const m3u8 = [
      '#EXTM3U',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:5,',
      'a.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:5,',
      'b.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const result = await stripAdSegmentsByPhysicalSignal(
      m3u8,
      'https://cdn.example.com/x/index.m3u8',
      'ua',
    );
    expect(result).toBe(m3u8);
  });

  // -------------- 信号 A: EXTINF 整数规律 --------------

  /** 构造正片段：每个段内 6 个零散浮点 EXTINF */
  function buildNormalSegment(seed: number): string[] {
    // 精度到微秒的零散浮点，模拟 rycj 源
    const durs = [
      4.170833 + seed * 0.01,
      3.628622 - seed * 0.007,
      5.130122 + seed * 0.003,
      2.002 + seed * 0.005,
      4.504 + seed * 0.002,
      3.378 + seed * 0.004,
    ];
    const lines: string[] = ['#EXT-X-DISCONTINUITY'];
    durs.forEach((d, i) => {
      lines.push(`#EXTINF:${d.toFixed(6)},`);
      lines.push(`normal_${seed}_${i}.ts`);
    });
    return lines;
  }

  /** 构造广告段：TS 时长清一色整数 + 尾帧 */
  function buildAdSegment(): string[] {
    const durs = [4.0, 4.0, 4.0, 4.0, 4.0, 2.0];
    const lines: string[] = ['#EXT-X-DISCONTINUITY'];
    durs.forEach((d, i) => {
      lines.push(`#EXTINF:${d.toFixed(6)},`);
      lines.push(`ad_${i}.ts`);
    });
    return lines;
  }

  test('EXTINF 整数规律段被识别并剔除', async () => {
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:8'];
    // 5 正 + 1 广告 + 3 正
    for (let i = 0; i < 5; i++) lines.push(...buildNormalSegment(i));
    lines.push(...buildAdSegment());
    for (let i = 5; i < 8; i++) lines.push(...buildNormalSegment(i));
    lines.push('#EXT-X-ENDLIST');
    const m3u8 = lines.join('\n');

    const result = await stripAdSegmentsByPhysicalSignal(
      m3u8,
      'https://cdn.example.com/x/index.m3u8',
      'ua',
    );
    // 广告 ts 全部被剔除
    expect(result).not.toMatch(/ad_\d+\.ts/);
    // 正片 ts 保留
    expect(result).toMatch(/normal_0_0\.ts/);
    expect(result).toMatch(/normal_7_5\.ts/);
    expect(result).not.toContain('#EXT-X-DISCONTINUITY');
  });

  test('EXTINF 40ms 粗粒度步进段被识别并剔除', async () => {
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:8'];
    for (let i = 0; i < 4; i++) lines.push(...buildNormalSegment(i));

    lines.push('#EXT-X-DISCONTINUITY');
    [4.0, 5.48, 4.0, 3.24, 4.0, 0.28].forEach((d, i) => {
      lines.push(`#EXTINF:${d.toFixed(6)},`);
      lines.push(`coarse_ad_${i}.ts`);
    });

    for (let i = 4; i < 8; i++) lines.push(...buildNormalSegment(i));
    lines.push('#EXT-X-ENDLIST');
    const m3u8 = lines.join('\n');

    const result = await stripAdSegmentsByPhysicalSignal(
      m3u8,
      'https://cdn.example.com/x/index.m3u8',
      'ua',
    );

    expect(result).not.toMatch(/coarse_ad_\d+\.ts/);
    expect(result).toMatch(/normal_0_0\.ts/);
    expect(result).toMatch(/normal_7_5\.ts/);
  });

  test('与正片等长的伪装网格广告段被识别并剔除', async () => {
    // rycj 第 8 集广告块及相邻正片的时长分布
    const contentDurations = [
      [4.170833, 4.170833, 5.755744, 3.420089, 2.836167],
      [2.460789, 5.296956, 4.212544, 4.295956, 5.171833],
      [4.004, 2.961289, 2.293967, 4.170833, 3.837167],
      [7.257244, 4.170833, 4.170833, 4.170833, 4.170833],
      [2.961289, 4.170833, 3.253256, 4.004, 5.005],
      [4.170833, 3.712044, 3.962289, 4.170833, 4.170833],
      [3.628622, 4.587922, 4.170833, 4.170833, 4.170833],
      [4.170833, 2.669333, 5.046711, 5.422078, 0.834222],
    ];
    const adDurations = [4, 5.48, 4, 3.24, 3.28];
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:8'];
    contentDurations.slice(0, 4).forEach((durs, segment) => {
      lines.push('#EXT-X-DISCONTINUITY');
      durs.forEach((duration, fragment) => {
        lines.push(`#EXTINF:${duration},`);
        lines.push(`main_${segment}_${fragment}.ts`);
      });
    });
    lines.push('#EXT-X-DISCONTINUITY');
    adDurations.forEach((duration, fragment) => {
      lines.push(`#EXTINF:${duration},`);
      lines.push(`camouflaged_ad_${fragment}.ts`);
    });
    contentDurations.slice(4).forEach((durs, offset) => {
      const segment = offset + 4;
      lines.push('#EXT-X-DISCONTINUITY');
      durs.forEach((duration, fragment) => {
        lines.push(`#EXTINF:${duration},`);
        lines.push(`main_${segment}_${fragment}.ts`);
      });
    });
    lines.push('#EXT-X-ENDLIST');

    const result = await stripAdSegmentsByPhysicalSignal(
      lines.join('\n'),
      'https://cdn.example.com/x/index.m3u8',
      'ua',
    );

    expect(result).not.toMatch(/camouflaged_ad_\d+\.ts/);
    expect(result.match(/main_\d+_\d+\.ts/g)).toHaveLength(40);
    contentDurations.forEach((durations, segment) => {
      durations.forEach((_, fragment) => {
        expect(result).toContain(`main_${segment}_${fragment}.ts`);
      });
    });
    expect(result).not.toContain('#EXT-X-DISCONTINUITY');
  });

  test('正片块时长离散时仍建立周期布局并连续化', async () => {
    const lines = ['#EXTM3U', '#EXT-X-TARGETDURATION:8'];
    const blockDurations = [
      17.2, 19.5, 20.1, 18.0, 21.4, 19.8, 22.5, 20.2, 18.6, 19.9,
    ];
    blockDurations.forEach((blockDuration, segment) => {
      lines.push('#EXT-X-DISCONTINUITY');
      const piece = blockDuration / 5;
      for (let fragment = 0; fragment < 5; fragment += 1) {
        lines.push(`#EXTINF:${piece.toFixed(6)},`);
        lines.push(`main_${segment}_${fragment}.ts`);
      }
    });
    lines.push('#EXT-X-ENDLIST');

    const result = await stripAdSegmentsByPhysicalSignal(
      lines.join('\n'),
      'https://cdn.example.com/x/index.m3u8',
      'ua',
    );

    expect(result).not.toContain('#EXT-X-DISCONTINUITY');
    expect(result.match(/main_\d+_\d+\.ts/g)).toHaveLength(50);
  });

  test('主流 5 秒切片中的单个 4 秒区间被识别并剔除', async () => {
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:5'];
    for (let segment = 0; segment < 10; segment++) {
      lines.push('#EXT-X-DISCONTINUITY');
      for (let fragment = 0; fragment < 5; fragment++) {
        const isAd = segment === 4;
        lines.push(`#EXTINF:${isAd ? '4.000000' : '5.000000'},`);
        lines.push(
          `${isAd ? 'duration_ad' : `normal_${segment}`}_${fragment}.ts`,
        );
      }
    }
    lines.push('#EXT-X-ENDLIST');
    const m3u8 = lines.join('\n');

    const result = await stripAdSegmentsByPhysicalSignal(
      m3u8,
      'https://cdn.example.com/x/index.m3u8',
      'ua',
    );

    expect(result).not.toMatch(/duration_ad_\d+\.ts/);
    expect(result).toMatch(/normal_3_4\.ts/);
    expect(result).toMatch(/normal_5_0\.ts/);
  });

  test('规律切片中的单个短尾片不被删除', async () => {
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:5'];
    for (let segment = 0; segment < 10; segment++) {
      lines.push('#EXT-X-DISCONTINUITY');
      for (let fragment = 0; fragment < 5; fragment++) {
        const duration = segment === 4 && fragment === 4 ? 1 : 5;
        lines.push(`#EXTINF:${duration.toFixed(6)},`);
        lines.push(`normal_${segment}_${fragment}.ts`);
      }
    }
    lines.push('#EXT-X-ENDLIST');
    const m3u8 = lines.join('\n');

    const result = await stripAdSegmentsByPhysicalSignal(
      m3u8,
      'https://cdn.example.com/x/index.m3u8',
      'ua',
    );

    expect(result).toContain('normal_4_4.ts');
    expect(result.match(/normal_\d+_\d+\.ts/g)).toHaveLength(50);
    expect(result).not.toContain('#EXT-X-DISCONTINUITY');
  });

  test('规律切片的短尾广告块被删除', async () => {
    const lines = ['#EXTM3U', '#EXT-X-TARGETDURATION:5'];
    for (let segment = 0; segment < 9; segment += 1) {
      lines.push('#EXT-X-DISCONTINUITY');
      for (let fragment = 0; fragment < 6; fragment += 1) {
        lines.push('#EXTINF:5.000000,');
        lines.push(`main_${segment}_${fragment}.ts`);
      }
    }
    lines.push('#EXT-X-DISCONTINUITY');
    lines.push('#EXTINF:5.000000,', 'tail_ad_0.ts');
    lines.push('#EXTINF:2.333333,', 'tail_ad_1.ts');
    lines.push('#EXT-X-ENDLIST');

    const result = await stripAdSegmentsByPhysicalSignal(
      lines.join('\n'),
      'https://cdn.example.com/x/index.m3u8',
      'ua',
    );

    expect(result).not.toContain('tail_ad_0.ts');
    expect(result).not.toContain('tail_ad_1.ts');
    expect(result).not.toContain('#EXT-X-DISCONTINUITY');
    expect(result.trim().endsWith('#EXT-X-ENDLIST')).toBe(true);
  });

  test('片尾单浮点短正片段不被删除', async () => {
    const lines = ['#EXTM3U', '#EXT-X-TARGETDURATION:8'];
    for (let segment = 0; segment < 10; segment += 1) {
      lines.push('#EXT-X-DISCONTINUITY');
      for (let fragment = 0; fragment < 5; fragment += 1) {
        lines.push(`#EXTINF:${(4.170833 + fragment * 0.01).toFixed(6)},`);
        lines.push(`main_${segment}_${fragment}.ts`);
      }
    }
    lines.push('#EXT-X-DISCONTINUITY');
    lines.push('#EXTINF:1.126200,', 'tail_content.ts');
    lines.push('#EXT-X-ENDLIST');

    const result = await stripAdSegmentsByPhysicalSignal(
      lines.join('\n'),
      'https://cdn.example.com/x/index.m3u8',
      'ua',
    );

    expect(result).toContain('tail_content.ts');
    expect(result).toContain('main_9_4.ts');
  });

  test('规律正片边界和广告删除边界全部连续化', async () => {
    const lines = ['#EXTM3U', '#EXT-X-TARGETDURATION:6'];
    for (let segment = 0; segment < 10; segment += 1) {
      lines.push('#EXT-X-DISCONTINUITY');
      const durations =
        segment === 4 ? [4, 5.48, 4, 3.24, 4, 0.28] : [5, 5, 5, 5, 5, 5];
      durations.forEach((duration, fragment) => {
        lines.push(`#EXTINF:${duration.toFixed(6)},`);
        lines.push(
          segment === 4
            ? `ad_${fragment}.ts`
            : `main_${segment}_${fragment}.ts`,
        );
      });
    }
    lines.push('#EXT-X-ENDLIST');

    const result = await stripAdSegmentsByPhysicalSignal(
      lines.join('\n'),
      'https://cdn.example.com/x/index.m3u8',
      'ua',
    );

    expect(result).not.toMatch(/ad_\d+\.ts/);
    expect(result).toContain('main_3_5.ts\n#EXTINF');
    expect(result).toContain('main_5_0.ts');
    expect(result).not.toContain('#EXT-X-DISCONTINUITY');
  });

  test('整片都是整数切片的源站不被误判', async () => {
    // 所有段 EXTINF 都是 4.0，基线整数率 = 1.0，差异 = 0 → 不判
    const lines = ['#EXTM3U'];
    for (let s = 0; s < 6; s++) {
      lines.push('#EXT-X-DISCONTINUITY');
      for (let i = 0; i < 5; i++) {
        lines.push('#EXTINF:4.000000,');
        lines.push(`s${s}_${i}.ts`);
      }
    }
    lines.push('#EXT-X-ENDLIST');
    const m3u8 = lines.join('\n');

    const result = await stripAdSegmentsByPhysicalSignal(
      m3u8,
      'https://cdn.example.com/x/index.m3u8',
      'ua',
    );
    expect(result).toBe(m3u8);
  });

  // -------------- 信号 B: Host 异常 --------------

  test('TS host 异常段被识别并剔除', async () => {
    const lines = ['#EXTM3U'];
    // 5 个正片段：相对路径（resolve 后 host = cdn.main.com）
    for (let s = 0; s < 5; s++) {
      lines.push('#EXT-X-DISCONTINUITY');
      for (let i = 0; i < 4; i++) {
        // 故意让时长零散，避免误触信号 A
        lines.push(`#EXTINF:${(4.17 + i * 0.11).toFixed(6)},`);
        lines.push(`normal_${s}_${i}.ts`);
      }
    }
    // 1 个广告段：绝对 URL 指向另一个 host
    lines.push('#EXT-X-DISCONTINUITY');
    for (let i = 0; i < 3; i++) {
      lines.push(`#EXTINF:${(5.23 + i * 0.09).toFixed(6)},`);
      lines.push(`https://ads.evil-cdn.net/ad_${i}.ts`);
    }
    lines.push('#EXT-X-ENDLIST');
    const m3u8 = lines.join('\n');

    const result = await stripAdSegmentsByPhysicalSignal(
      m3u8,
      'https://cdn.main.com/x/index.m3u8',
      'ua',
    );
    expect(result).not.toMatch(/ads\.evil-cdn\.net/);
    expect(result).toMatch(/normal_0_0\.ts/);
  });

  test('段内只有 1 个绝对 URL 时不足以判广告', async () => {
    // 保守策略：段内至少 2 个绝对 URL TS 才启用 host 异常识别
    const lines = ['#EXTM3U'];
    for (let s = 0; s < 4; s++) {
      lines.push('#EXT-X-DISCONTINUITY');
      for (let i = 0; i < 4; i++) {
        lines.push(`#EXTINF:${(4.17 + i * 0.11).toFixed(6)},`);
        lines.push(`normal_${s}_${i}.ts`);
      }
    }
    lines.push('#EXT-X-DISCONTINUITY');
    lines.push('#EXTINF:5.231,');
    lines.push('https://ads.evil-cdn.net/only_one.ts');
    lines.push('#EXT-X-ENDLIST');
    const m3u8 = lines.join('\n');

    const result = await stripAdSegmentsByPhysicalSignal(
      m3u8,
      'https://cdn.main.com/x/index.m3u8',
      'ua',
    );
    expect(result).toMatch(/only_one\.ts/);
  });

  // -------------- 短路路径 --------------

  test('段切分不规整（众数覆盖率低）且无 A/B 信号时原样返回', async () => {
    // 5 段时长各异，无明显众数；EXTINF 浮点无整数；全相对路径
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:10'];
    const durs = [5.123, 8.456, 12.789, 6.111, 10.333];
    durs.forEach((d, i) => {
      lines.push('#EXT-X-DISCONTINUITY');
      lines.push(`#EXTINF:${d.toFixed(6)},`);
      lines.push(`s${i}.ts`);
    });
    lines.push('#EXT-X-ENDLIST');
    const m3u8 = lines.join('\n');
    const result = await stripAdSegmentsByPhysicalSignal(
      m3u8,
      'https://cdn.example.com/x/index.m3u8',
      'ua',
    );
    expect(result).toBe(m3u8);
  });
});
