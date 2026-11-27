import {
  type SourceHealthTier,
  buildSourceHealthDaily,
  getEffectiveSmoothDaily,
  hasSourceSmoothDimension,
  isSmoothSampleStuttering,
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
      smoothRate: null,
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

describe('smoothness policy', () => {
  const sample = {
    source: 'a',
    bucketDate: '2026-11-04',
    reporter: 'r',
    watchMs: 600_000,
    stallMs: 0,
    stallCount: 0,
  };
  const rows = (count: number, accounts = 5, stuttering = true) =>
    getEffectiveSmoothDaily(
      Array.from({ length: count }, (_, index) => ({
        ...sample,
        reporter: `r${index % accounts}`,
        bucketDate: `2026-11-${String(Math.floor(index / accounts) + 1).padStart(2, '0')}`,
        stallMs: stuttering ? 60_000 : 0,
        stallCount: stuttering ? 3 : 0,
      })),
    );
  const scored = (count: number, accounts = 5, stuttering = true) =>
    scoreSourceHealth(
      'a',
      search(100),
      play(100),
      null,
      [],
      rows(count, accounts, stuttering),
    );

  it.each<[number, number, boolean]>([
    [19, 5, false],
    [20, 4, false],
    [20, 5, true],
  ])(
    'enables smooth dimension for %i reporter-days and %i accounts: %s',
    (smoothReporterDays, smoothAccounts, expected) => {
      expect(
        hasSourceSmoothDimension({ smoothReporterDays, smoothAccounts }),
      ).toBe(expected);
    },
  );

  it('classifies only sufficiently observed samples and uses both stall metrics', () => {
    expect(
      isSmoothSampleStuttering({
        ...sample,
        watchMs: 299_999,
        stallMs: 60_000,
      }),
    ).toBeNull();
    expect(isSmoothSampleStuttering({ ...sample, watchMs: 300_000 })).toBe(
      false,
    );
    expect(isSmoothSampleStuttering({ ...sample, stallMs: 10_000 })).toBe(true);
    expect(isSmoothSampleStuttering({ ...sample, stallCount: 2 })).toBe(true);
    expect(isSmoothSampleStuttering({ ...sample, stallCount: 1 })).toBe(false);
  });

  it('preserves old score below either threshold and takes the smoothed weakest signal above both', () => {
    expect(scored(19)).toMatchObject({
      score: 99,
      tier: 'good',
      smoothReporterDays: 19,
      smoothRate: 0,
    });
    expect(scored(20, 4)).toMatchObject({
      score: 99,
      tier: 'good',
      smoothAccounts: 4,
    });
    const result = scored(20);
    expect(result).toMatchObject({
      score: 5,
      tier: 'poor',
      smoothReporterDays: 20,
      smoothAccounts: 5,
      smoothRate: 0,
      smoothWatchMs: 12_000_000,
    });
    expect(result.stallRatio).toBeCloseTo(1 / 11);
    expect(result.stallsPer10Min).toBeCloseTo(30 / 11);
    expect(scored(20, 5, false)).toMatchObject({ score: 95, smoothRate: 1 });
    expect(
      scoreSourceHealth('a', [], undefined, null, [], rows(20, 5, false)),
    ).toMatchObject({ score: 95, tier: 'good', lastOkDate: null });
    expect(
      scoreSourceHealth(
        'a',
        [
          ...search(0, 0, 5),
          { ...search(0, 0, 5)[0], bucketDate: '2026-11-03' },
        ],
        undefined,
        null,
        [],
        rows(20, 5, false),
      ).tier,
    ).toBe('offline');
    expect(
      scoreSourceHealth(
        'a',
        search(0, 0, 100),
        undefined,
        null,
        [],
        rows(20, 5, false),
      ).score,
    ).toBe(1);
  });

  it('excludes a reporter-day only with three distinct stuttering sources and no smooth source', () => {
    const bad = ['a', 'b', 'c'].map((source) => ({
      ...sample,
      source,
      stallMs: 60_000,
    }));
    expect(getEffectiveSmoothDaily(bad)).toEqual([]);
    expect(getEffectiveSmoothDaily(bad.slice(0, 2))).toHaveLength(2);
    expect(
      getEffectiveSmoothDaily([
        ...bad,
        { ...sample, source: 'd', watchMs: 100 },
      ]),
    ).toEqual([]);
    expect(
      getEffectiveSmoothDaily([...bad, { ...sample, source: 'd' }]),
    ).toHaveLength(4);
    expect(
      getEffectiveSmoothDaily([
        ...bad,
        { ...sample, reporter: 'other' },
        { ...sample, bucketDate: '2026-11-03' },
      ]),
    ).toHaveLength(2);
    expect(getEffectiveSmoothDaily([bad[0], bad[0], bad[0]])).toHaveLength(3);
  });

  it('only downgrades ok days after account and watch thresholds', () => {
    const smooth = getEffectiveSmoothDaily(
      [0, 1, 2].map((index) => ({
        ...sample,
        reporter: `r${index}`,
        stallMs: 60_000,
      })),
    );
    const daily = (ok: number, errors = 0, data = smooth) =>
      buildSourceHealthDaily(
        [sample.bucketDate],
        search(ok, 0, errors),
        [],
        data,
      )[0].status;
    expect(daily(5)).toBe('degraded');
    expect(daily(0)).toBe('none');
    expect(daily(0, 5)).toBe('down');
    expect(daily(5, 0, smooth.slice(0, 2))).toBe('ok');
    expect(
      daily(
        5,
        0,
        smooth.map((row) => ({ ...row, watchMs: 599_999 })),
      ),
    ).toBe('ok');
    expect(
      daily(
        5,
        0,
        smooth.map((row) => ({ ...row, stuttering: false })),
      ),
    ).toBe('ok');
  });

  it('exposes only the qualified raw smooth rate', () => {
    expect(toPublicSourceHealth(scored(19))?.smoothRate).toBeNull();
    expect(toPublicSourceHealth(scored(20, 4))?.smoothRate).toBeNull();
    const result = toPublicSourceHealth(scored(20, 5, false));
    expect(result?.smoothRate).toBe(1);
    expect(result).not.toHaveProperty('smoothAccounts');
    expect(result).not.toHaveProperty('smoothBreakdown');
    expect(result).not.toHaveProperty('smoothReporterDays');
  });
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
