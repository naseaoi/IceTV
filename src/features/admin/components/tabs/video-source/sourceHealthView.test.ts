import type { SourceHealthReportItem } from '@/lib/source-quality-policy';

import {
  describeSourceHealth,
  formatLastOkDate,
  getProxyStutterNotice,
  isSourceCleanupCandidate,
  isSourceStuttering,
  sortByHealth,
} from './sourceHealthView';

const HOUR_MS = 60 * 60 * 1000;

const NOW = Date.parse('2026-11-04T12:00:00Z');

function item(
  overrides: Partial<SourceHealthReportItem> = {},
): SourceHealthReportItem {
  return {
    source: 'a',
    score: 90,
    tier: 'good',
    searchAttempts: 40,
    searchAvailability: 0.95,
    avgSearchLatencyMs: 1250,
    playReporterDays: 6,
    playSuccessRate: 0.8,
    smoothReporterDays: 0,
    smoothAccounts: 0,
    smoothRate: null,
    stallRatio: null,
    stallsPer10Min: null,
    smoothWatchMs: 0,
    smoothBreakdown: [],
    lastOkDate: '2026-11-04',
    daily: [],
    ...overrides,
  };
}

describe('sourceHealthView', () => {
  it('flags only poor and offline sources for cleanup', () => {
    expect(isSourceCleanupCandidate(item({ tier: 'poor' }))).toBe(true);
    expect(isSourceCleanupCandidate(item({ tier: 'offline' }))).toBe(true);
    expect(isSourceCleanupCandidate(item({ tier: 'insufficient' }))).toBe(
      false,
    );
    expect(isSourceCleanupCandidate(null)).toBe(false);
  });

  it('formats last ok date relative to UTC today', () => {
    expect(formatLastOkDate('2026-11-04', NOW)).toBe('今天');
    expect(formatLastOkDate('2026-11-03', NOW)).toBe('昨天');
    expect(formatLastOkDate('2026-10-29', NOW)).toBe('6 天前');
    expect(formatLastOkDate(null, NOW)).toBe('30 天内无');
  });

  it('describes signals and marks missing ones', () => {
    expect(describeSourceHealth(item(), 7, NOW)).toBe(
      [
        '近 7 天 · 优质',
        '搜索可用 95% · 40 次',
        '平均耗时 1.3 秒',
        '播放可用（含测速） 80% · 6 上报者日',
        '播放流畅 无样本',
        '最近可用 今天',
      ].join('\n'),
    );
    expect(
      describeSourceHealth(
        item({
          tier: 'insufficient',
          score: null,
          searchAttempts: 0,
          searchAvailability: null,
          avgSearchLatencyMs: null,
          playReporterDays: 0,
          playSuccessRate: null,
          lastOkDate: null,
        }),
        7,
        NOW,
      ),
    ).toBe(
      [
        '近 7 天 · 样本不足',
        '搜索 无样本',
        '播放可用（含测速） 无样本',
        '播放流畅 无样本',
        '最近可用 30 天内无',
      ].join('\n'),
    );
  });

  it('describes smoothness with per-layer breakdown', () => {
    const description = describeSourceHealth(
      item({
        smoothReporterDays: 24,
        smoothAccounts: 6,
        smoothRate: 0.75,
        stallRatio: 0.012,
        stallsPer10Min: 1.5,
        smoothWatchMs: 8.5 * HOUR_MS,
        smoothBreakdown: [
          {
            source: 'a',
            routeMode: 'browser',
            mediaType: 'hls',
            watchMs: 10 * HOUR_MS,
            stallMs: 0,
            stallCount: 0,
            unknownMs: 3 * 60_000,
            reporterDays: 20,
          },
        ],
      }),
      7,
      NOW,
    );
    expect(description.split('\n')).toContain(
      '播放流畅 75% · 24 上报者日 · 6 人',
    );
    expect(description).toContain(
      '卡顿率 1.2% · 每 10 分钟 1.5 次 · 观察 8.5 小时',
    );
    expect(description).toContain(
      '直连 HLS 卡顿率 0.0% · 每 10 分钟 0.0 次 · 10 小时 · 未归因等待 3 分钟',
    );
    expect(
      describeSourceHealth(
        item({ smoothReporterDays: 4, smoothAccounts: 2, smoothRate: 0.5 }),
        7,
        NOW,
      ),
    ).toContain('播放流畅 50% · 4 上报者日 · 2 人（样本不足，未计分）');
  });

  it('flags stuttering only when the smoothness dimension is scored', () => {
    const scored = { smoothReporterDays: 20, smoothAccounts: 5 };
    expect(isSourceStuttering(item({ ...scored, smoothRate: 0.8 }))).toBe(true);
    expect(isSourceStuttering(item({ ...scored, smoothRate: 0.9 }))).toBe(
      false,
    );
    expect(
      isSourceStuttering(
        item({ smoothReporterDays: 19, smoothAccounts: 5, smoothRate: 0.2 }),
      ),
    ).toBe(false);
    expect(isSourceStuttering(item({ ...scored, smoothRate: 0.8499 }))).toBe(
      true,
    );
    expect(isSourceStuttering(item({ ...scored, smoothRate: 0.85 }))).toBe(
      false,
    );
    expect(isSourceStuttering(item({ ...scored, smoothRate: null }))).toBe(
      false,
    );
    expect(
      isSourceStuttering(
        item({ smoothReporterDays: 20, smoothAccounts: 4, smoothRate: 0.2 }),
      ),
    ).toBe(false);
    expect(isSourceStuttering(null)).toBe(false);
    expect(isSourceStuttering(undefined)).toBe(false);
  });

  it('notices proxy-wide stutter only when proxy is clearly worse', () => {
    const layer = (
      routeMode: 'browser' | 'server',
      watchMs: number,
      stallMs: number,
    ) => ({
      source: 'a',
      routeMode,
      mediaType: 'hls' as const,
      watchMs,
      stallMs,
      stallCount: 1,
      unknownMs: 0,
      reporterDays: 10,
    });
    const withLayers = (...layers: ReturnType<typeof layer>[]) => [
      item({ smoothBreakdown: layers }),
    ];
    expect(
      getProxyStutterNotice(
        withLayers(
          layer('browser', 20 * HOUR_MS, 0.005 * 20 * HOUR_MS),
          layer('server', 20 * HOUR_MS, 0.04 * 20 * HOUR_MS),
        ),
      ),
    ).toBe('代理线路整体卡顿率 3.8%，直连 0.5%，优先排查本站出口带宽');
    // 代理不足直连两倍
    expect(
      getProxyStutterNotice(
        withLayers(
          layer('browser', 20 * HOUR_MS, 0.02 * 20 * HOUR_MS),
          layer('server', 20 * HOUR_MS, 0.03 * 20 * HOUR_MS),
        ),
      ),
    ).toBeNull();
    // 直连观察不足
    expect(
      getProxyStutterNotice(
        withLayers(
          layer('browser', 5 * HOUR_MS, 0),
          layer('server', 20 * HOUR_MS, 0.04 * 20 * HOUR_MS),
        ),
      ),
    ).toBeNull();
  });

  it('sorts by tier, then score, then manual order', () => {
    const sources = ['off', 'none', 'n80', 'g90', 'n85', 'poor', 'n80b'].map(
      (key) => ({ key }),
    );
    const health = new Map<string, SourceHealthReportItem>([
      ['off', item({ source: 'off', tier: 'offline', score: 8 })],
      ['n80', item({ source: 'n80', tier: 'normal', score: 80 })],
      ['g90', item({ source: 'g90', tier: 'good', score: 90 })],
      ['n85', item({ source: 'n85', tier: 'normal', score: 85 })],
      ['poor', item({ source: 'poor', tier: 'poor', score: 30 })],
      ['n80b', item({ source: 'n80b', tier: 'normal', score: 80 })],
    ]);
    expect(sortByHealth(sources, health).map(({ key }) => key)).toEqual([
      'g90',
      'n85',
      'n80',
      'n80b',
      'none',
      'poor',
      'off',
    ]);
  });
});
