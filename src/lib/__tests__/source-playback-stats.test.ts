import {
  type SourcePlaybackStat,
  compareSourcePlaybackPreference,
  isTrustedSourcePlaybackStat,
  readSourcePlaybackStats,
  recordSourceManualSelection,
  recordSourcePlaybackFailure,
  recordSourcePlaybackSuccess,
  sortSourcesByPlaybackStats,
  SOURCE_PLAYBACK_STATS_STORAGE_KEY,
} from '@/lib/source-playback-stats';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 1);

function stat(overrides: Partial<SourcePlaybackStat>): SourcePlaybackStat {
  return {
    startupMs: null,
    successes: 0,
    failures: 0,
    manualSelections: 0,
    lastUsedAt: NOW,
    ...overrides,
  };
}

describe('source playback stats storage', () => {
  let now = NOW;

  beforeEach(() => {
    now = NOW;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records startup time as an exponentially weighted average', () => {
    recordSourcePlaybackSuccess('giri', 1_000);
    recordSourcePlaybackSuccess('giri', 2_000);

    expect(readSourcePlaybackStats().get('giri')).toEqual({
      startupMs: 1_300,
      successes: 2,
      failures: 0,
      manualSelections: 0,
      lastUsedAt: NOW,
    });
  });

  it('keeps counting successes without a valid startup sample', () => {
    recordSourcePlaybackSuccess('giri', Number.NaN);
    recordSourcePlaybackSuccess('giri', 500_000);

    expect(readSourcePlaybackStats().get('giri')).toMatchObject({
      startupMs: 120_000,
      successes: 2,
    });
  });

  it('records failures and manual selections separately', () => {
    recordSourcePlaybackFailure('xigua');
    recordSourceManualSelection('xigua');
    recordSourceManualSelection('xigua');

    expect(readSourcePlaybackStats().get('xigua')).toMatchObject({
      failures: 1,
      manualSelections: 2,
      successes: 0,
    });
  });

  it('halves counts for every full idle period before recording', () => {
    for (let index = 0; index < 8; index += 1) {
      recordSourcePlaybackSuccess('giri', 1_000);
    }
    now += 29 * DAY_MS;
    recordSourcePlaybackFailure('giri');

    expect(readSourcePlaybackStats().get('giri')).toMatchObject({
      successes: 2,
      failures: 1,
      lastUsedAt: now,
    });
  });

  it('caps the attempt weight so recent results dominate', () => {
    for (let index = 0; index < 25; index += 1) {
      recordSourcePlaybackSuccess('giri', 1_000);
    }
    recordSourcePlaybackFailure('giri');

    const entry = readSourcePlaybackStats().get('giri');
    expect((entry?.successes ?? 0) + (entry?.failures ?? 0)).toBeCloseTo(20, 1);
    expect(entry?.failures).toBeGreaterThan(0);
  });

  it('keeps only the most recently used sources', () => {
    for (let index = 0; index < 45; index += 1) {
      now += 1_000;
      recordSourceManualSelection(`source-${index}`);
    }

    const stats = readSourcePlaybackStats();
    expect(stats.size).toBe(40);
    expect(stats.has('source-0')).toBe(false);
    expect(stats.has('source-44')).toBe(true);
  });

  it('ignores invalid keys, malformed storage and failed writes', () => {
    recordSourcePlaybackSuccess('', 1_000);
    expect(readSourcePlaybackStats().size).toBe(0);

    window.localStorage.setItem(SOURCE_PLAYBACK_STATS_STORAGE_KEY, '{oops');
    expect(readSourcePlaybackStats().size).toBe(0);

    window.localStorage.setItem(
      SOURCE_PLAYBACK_STATS_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        entries: [
          ['ok', stat({ successes: 1 })],
          ['bad', { successes: -1 }],
          [42, stat({})],
        ],
      }),
    );
    expect(Array.from(readSourcePlaybackStats().keys())).toEqual(['ok']);

    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => recordSourcePlaybackSuccess('giri', 1_000)).not.toThrow();
  });
});

describe('source playback preference', () => {
  it('trusts recently used sources with enough successful starts', () => {
    expect(isTrustedSourcePlaybackStat(stat({ successes: 3 }), NOW)).toBe(true);
    expect(isTrustedSourcePlaybackStat(stat({ successes: 2 }), NOW)).toBe(
      false,
    );
    expect(
      isTrustedSourcePlaybackStat(stat({ successes: 4, failures: 2 }), NOW),
    ).toBe(false);
    expect(
      isTrustedSourcePlaybackStat(
        stat({ successes: 10, lastUsedAt: NOW - 15 * DAY_MS }),
        NOW,
      ),
    ).toBe(false);
    expect(isTrustedSourcePlaybackStat(undefined, NOW)).toBe(false);
  });

  it('orders trusted, neutral and unreliable sources', () => {
    const stats = new Map<string, SourcePlaybackStat>([
      ['slow-trusted', stat({ successes: 5, startupMs: 3_000 })],
      ['fast-trusted', stat({ successes: 4, startupMs: 900 })],
      ['picked', stat({ manualSelections: 3 })],
      ['broken', stat({ successes: 1, failures: 3 })],
    ]);
    const items = [
      'unknown-a',
      'broken',
      'slow-trusted',
      'picked',
      'unknown-b',
      'fast-trusted',
    ];

    expect(
      sortSourcesByPlaybackStats(items, (item) => item, stats, NOW),
    ).toEqual([
      'fast-trusted',
      'slow-trusted',
      'picked',
      'unknown-a',
      'unknown-b',
      'broken',
    ]);
  });

  it('treats sources without stats as equal to keep the original order', () => {
    expect(compareSourcePlaybackPreference(undefined, undefined, NOW)).toBe(0);
    expect(
      compareSourcePlaybackPreference(stat({ successes: 1 }), undefined, NOW),
    ).toBe(0);
  });
});
