import {
  type SourceHealthTier,
  buildSourceHealthDaily,
  rankSourcesByHealth,
  scoreSourceHealth,
  SOURCE_HEALTH_PUBLIC_MIN_PLAY_REPORTER_DAYS,
  toPublicSourceHealth,
} from '@/lib/source-quality-policy';
import type {
  SourceHealthSearchDaily,
  SourcePlayReporterSummary,
} from '@/lib/types';

function search(
  ok: number,
  empty = 0,
  error = 0,
  latency = 1000,
): SourceHealthSearchDaily[] {
  return [
    {
      source: 'a',
      bucketDate: '2026-11-04',
      okCount: ok,
      emptyCount: empty,
      errorCount: error,
      latencyMsSum: (ok + empty) * latency,
      latencySamples: ok + empty,
    },
  ];
}
function play(success: number, failure = 0): SourcePlayReporterSummary {
  return {
    source: 'a',
    successReporterDays: success,
    failureReporterDays: failure,
    lastSuccessDate: null,
  };
}
const score = (rows = search(0), reports?: SourcePlayReporterSummary) =>
  scoreSourceHealth('a', rows, reports, null);

describe('source quality policy', () => {
  it('requires either ten searches or three reporter-days', () => {
    expect(score()).toMatchObject({
      tier: 'insufficient',
      score: null,
      searchAvailability: null,
      playSuccessRate: null,
      avgSearchLatencyMs: null,
    });
    expect(score(search(9), play(2))).toMatchObject({
      tier: 'insufficient',
      score: null,
    });
    expect(score(search(10)).tier).toBe('good');
    expect(score(search(0), play(3)).tier).toBe('normal');
  });

  it('marks all search failures offline only across days and without a play success', () => {
    const twoDays = [
      ...search(0, 0, 5),
      { ...search(0, 0, 5)[0], bucketDate: '2026-11-03' },
    ];
    expect(score(twoDays, play(0, 2)).tier).toBe('offline');
    expect(score(search(0, 0, 10), play(0, 2)).tier).toBe('poor');
    expect(score(twoDays, play(1)).tier).toBe('poor');
  });

  it('counts empty searches as available and applies the latency threshold', () => {
    expect(score(search(0, 10, 0, 3000))).toMatchObject({
      tier: 'good',
      avgSearchLatencyMs: 3000,
    });
    expect(score(search(10, 0, 0, 3001)).tier).toBe('normal');
    expect(score(search(0), play(10))).toMatchObject({
      tier: 'good',
      avgSearchLatencyMs: null,
    });
  });

  it('uses only a sufficiently sampled signal', () => {
    const searchOnly = score(search(10), play(0, 2));
    expect(searchOnly.score).toBe(92);
    const playOnly = score(search(0, 0, 9), play(0, 3));
    expect(playOnly).toMatchObject({ tier: 'poor', score: 20 });
  });

  it('uses the weaker qualified signal and retains exact threshold semantics', () => {
    expect(score(search(10), play(0, 3)).score).toBe(20);
    expect(score(search(4, 0, 6)).tier).toBe('poor');
    expect(score(search(5, 0, 5))).toMatchObject({ score: 50, tier: 'normal' });
    expect(score(search(16, 0, 2))).toMatchObject({ score: 85, tier: 'good' });
  });

  it('smooths the score but reports raw rates for display', () => {
    expect(score(search(10))).toMatchObject({
      score: 92,
      searchAvailability: 1,
    });
    expect(score(search(0, 0, 10))).toMatchObject({
      score: 8,
      searchAvailability: 0,
    });
    expect(score(search(100)).score).toBe(99);
    expect(score(search(0), play(0, 1)).playSuccessRate).toBe(0);
    expect(
      scoreSourceHealth('a', search(10), undefined, '2026-10-20').lastOkDate,
    ).toBe('2026-10-20');
  });
});

describe('daily source health', () => {
  const date = '2026-11-04';
  const dailyStatus = (
    ok: number,
    errors: number,
    success: number,
    failure: number,
  ) =>
    buildSourceHealthDaily([date], search(ok, 0, errors), [
      {
        source: 'a',
        bucketDate: date,
        successReporterDays: success,
        failureReporterDays: failure,
      },
    ])[0].status;

  it('uses daily raw rates with independent sample thresholds and the weaker signal', () => {
    expect(dailyStatus(4, 0, 2, 0)).toBe('none');
    expect(dailyStatus(5, 0, 0, 2)).toBe('ok');
    expect(dailyStatus(0, 4, 3, 0)).toBe('ok');
    expect(dailyStatus(10, 0, 1, 2)).toBe('down');
    expect(dailyStatus(2, 3, 3, 0)).toBe('down');
    expect(dailyStatus(17, 3, 0, 0)).toBe('ok');
    expect(dailyStatus(16, 4, 0, 0)).toBe('degraded');
    expect(dailyStatus(5, 5, 0, 0)).toBe('degraded');
    expect(dailyStatus(4, 6, 0, 0)).toBe('down');
    expect(dailyStatus(0, 0, 17, 3)).toBe('ok');
    expect(dailyStatus(0, 0, 2, 2)).toBe('degraded');
  });

  it('preserves requested date order and fills missing days', () => {
    expect(
      buildSourceHealthDaily(['2026-11-03', date, '2026-11-05'], search(5), []),
    ).toEqual([
      { date: '2026-11-03', status: 'none' },
      { date, status: 'ok' },
      { date: '2026-11-05', status: 'none' },
    ]);
  });
});

describe('public source health', () => {
  it('requires twenty reporter-days except for offline and never exposes insufficient', () => {
    expect(SOURCE_HEALTH_PUBLIC_MIN_PLAY_REPORTER_DAYS).toBe(20);
    for (const tier of ['good', 'normal', 'poor'] as const) {
      expect(
        toPublicSourceHealth({ ...score(), tier, playReporterDays: 19 }),
      ).toBeNull();
      expect(
        toPublicSourceHealth({ ...score(), tier, playReporterDays: 20 })?.tier,
      ).toBe(tier);
    }
    expect(
      toPublicSourceHealth({ ...score(), playReporterDays: 100 }),
    ).toBeNull();
    expect(
      toPublicSourceHealth({ ...score(), tier: 'offline', playSuccessRate: 0 }),
    ).toMatchObject({ tier: 'offline', playAvailability: null });
  });

  it('projects only public fields and preserves raw availability and independent daily points', () => {
    const item = scoreSourceHealth(
      'a',
      search(90, 0, 10),
      play(72, 28),
      '2026-11-04',
      [{ date: '2026-11-04', status: 'degraded' }],
    );
    const result = toPublicSourceHealth(item)!;
    expect(result).toEqual({
      tier: 'normal',
      playAvailability: 0.72,
      searchAvailability: 0.9,
      lastOkDate: '2026-11-04',
      daily: [{ date: '2026-11-04', status: 'degraded' }],
    });
    result.daily[0].status = 'none';
    expect(item.daily[0].status).toBe('degraded');
  });

  it.each([20, 67, 72, 73])(
    'does not let 95%% search availability hide %s%% play availability',
    (success) => {
      expect(score(search(95, 0, 5), play(success, 100 - success)).tier).toBe(
        success < 50 ? 'poor' : 'normal',
      );
    },
  );
});

describe('rankSourcesByHealth', () => {
  const sites = ['z', 'b', 'a', 'c', 'd', 'e', 'f'].map((key) => ({ key }));

  it('preserves the exact input order without data and does not mutate it', () => {
    const result = rankSourcesByHealth(sites, new Map());
    expect(result).toEqual(sites);
    expect(result).not.toBe(sites);
    expect(
      rankSourcesByHealth(
        sites,
        new Map(sites.map(({ key }) => [key, 'insufficient'])),
      ),
    ).toEqual(sites);
  });

  it('orders tiers stably, treats missing data as insufficient and keeps every source', () => {
    const tiers = new Map<string, SourceHealthTier>([
      ['z', 'offline'],
      ['b', 'good'],
      ['a', 'good'],
      ['c', 'poor'],
      ['d', 'normal'],
      ['e', 'insufficient'],
    ]);
    expect(rankSourcesByHealth(sites, tiers).map(({ key }) => key)).toEqual([
      'b',
      'a',
      'd',
      'e',
      'f',
      'c',
      'z',
    ]);
    expect(rankSourcesByHealth(sites, new Map([...tiers].reverse()))).toEqual(
      rankSourcesByHealth(sites, tiers),
    );
    expect(sites.map(({ key }) => key)).toEqual([
      'z',
      'b',
      'a',
      'c',
      'd',
      'e',
      'f',
    ]);
  });
});
