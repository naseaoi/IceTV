import {
  type SourceHealthTier,
  rankSourcesByHealth,
  scoreSourceHealth,
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

  it('weights qualified signals 60/40 and retains exact threshold semantics', () => {
    expect(score(search(10), play(0, 3)).score).toBeCloseTo(63);
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
