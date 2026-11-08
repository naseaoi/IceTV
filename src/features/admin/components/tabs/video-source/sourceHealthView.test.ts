import type { SourceHealthReportItem } from '@/lib/source-quality-policy';

import {
  describeSourceHealth,
  formatLastOkDate,
  isSourceCleanupCandidate,
  sortByHealth,
} from './sourceHealthView';

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
    lastOkDate: '2026-11-04',
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
        '播放成功 80% · 6 人次',
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
        '播放 无样本',
        '最近可用 30 天内无',
      ].join('\n'),
    );
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
