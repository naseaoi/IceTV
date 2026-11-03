import type { PlaybackPeriodSession } from '@/lib/types';

import {
  aggregatePlaybackPeriod,
  buildPlaybackPeriod,
  PlaybackPeriodValidationError,
} from './period';

const instant = (value: string) => Date.parse(value);
const session = (
  overrides: Partial<PlaybackPeriodSession> = {},
): PlaybackPeriodSession => ({
  source: 'a',
  video_id: 'one',
  title: 'Show A',
  year: '2026',
  cover: 'old',
  started_at: instant('2026-11-02T17:00:00Z'),
  ended_at: instant('2026-11-02T18:00:00Z'),
  watch_seconds: 60,
  ...overrides,
});

describe('calendar playback periods', () => {
  it('defaults to the current calendar week and UTC', () => {
    const period = buildPlaybackPeriod({}, instant('2026-11-03T17:00:00Z'));
    expect(period).toMatchObject({
      type: 'week',
      date: '2026-11-03',
      timeZone: 'UTC',
      start: instant('2026-11-02T00:00:00Z'),
      end: instant('2026-11-09T00:00:00Z'),
    });
    expect(period.buckets.map((bucket) => bucket.key)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
    expect(period.buckets.every((bucket) => bucket.watchSeconds === 0)).toBe(
      true,
    );
  });

  it('derives the default date in the requested time zone', () => {
    expect(
      buildPlaybackPeriod(
        { timeZone: 'Asia/Shanghai' },
        instant('2026-11-02T17:00:00Z'),
      ).date,
    ).toBe('2026-11-03');
  });

  it.each([
    ['2026-03-08', '2026-03-02T05:00:00Z', '2026-03-09T04:00:00Z', 23],
    ['2026-11-01', '2026-10-26T04:00:00Z', '2026-11-02T05:00:00Z', 25],
  ])(
    'uses DST-correct Monday and Sunday boundaries for %s',
    (date, start, end, hours) => {
      const period = buildPlaybackPeriod({
        date,
        timeZone: 'America/New_York',
      });
      expect(period.start).toBe(instant(start));
      expect(period.end).toBe(instant(end));
      expect(period.buckets[6].end - period.buckets[6].start).toBe(
        Number(hours) * 3_600_000,
      );
    },
  );

  it.each([
    ['2024-02-19', 29],
    ['2025-02-19', 28],
    ['2026-04-19', 30],
    ['2026-12-19', 31],
  ])('covers every day in month %s', (date, count) => {
    const period = buildPlaybackPeriod({ type: 'month', date });
    expect(period.buckets).toHaveLength(Number(count));
    expect(new Date(period.start).getUTCDate()).toBe(1);
    expect(new Date(period.end).getUTCDate()).toBe(1);
  });

  it('builds DST-aware monthly buckets for an entire year', () => {
    const period = buildPlaybackPeriod({
      type: 'year',
      date: '2026-11-03',
      timeZone: 'America/New_York',
    });
    expect(period.start).toBe(instant('2026-01-01T05:00:00Z'));
    expect(period.end).toBe(instant('2027-01-01T05:00:00Z'));
    expect(period.buckets).toHaveLength(12);
    expect(period.buckets[2]).toEqual({
      key: '2026-03',
      start: instant('2026-03-01T05:00:00Z'),
      end: instant('2026-04-01T04:00:00Z'),
      watchSeconds: 0,
    });
    expect(period.buckets[10].end - period.buckets[10].start).toBe(
      (30 * 24 + 1) * 3_600_000,
    );
    expect(
      buildPlaybackPeriod({
        type: 'month',
        date: '2026-03-15',
        timeZone: 'America/New_York',
      }).end,
    ).toBe(period.buckets[2].end);
  });

  it('handles zones whose DST transition skips midnight', () => {
    const period = buildPlaybackPeriod({
      date: '2018-11-04',
      timeZone: 'America/Sao_Paulo',
    });
    expect(period.buckets[6].start).toBe(instant('2018-11-04T03:00:00Z'));
    expect(period.buckets[6].end - period.buckets[6].start).toBe(
      23 * 3_600_000,
    );
  });

  it.each([
    { type: 'all' },
    { type: '' },
    { timeZone: 'invalid/zone' },
    { timeZone: '' },
    { date: '2026-2-03' },
    { date: '2026-02-30' },
    { date: '2025-02-29' },
    { date: '2026-13-01' },
    { date: '' },
  ])('rejects invalid input %j', (input) => {
    expect(() => buildPlaybackPeriod(input)).toThrow(
      PlaybackPeriodValidationError,
    );
  });
});

describe('period aggregation', () => {
  it('attributes sessions by local start date and counts active days only once', () => {
    for (const [timeZone, day] of [
      ['UTC', '2026-11-02'],
      ['Asia/Shanghai', '2026-11-03'],
    ]) {
      const period = buildPlaybackPeriod({ date: '2026-11-03', timeZone });
      const result = aggregatePlaybackPeriod(
        period,
        [
          session(),
          session({ watch_seconds: 20 }),
          session({ watch_seconds: 0 }),
          session({ watch_seconds: -20 }),
          session({ started_at: period.start - 1 }),
          session({ started_at: period.end }),
        ],
        999,
      );
      expect(result).toMatchObject({
        watchSeconds: 80,
        activeDays: 1,
        lifetimeWatchSeconds: 999,
      });
      expect(
        result.buckets.find((bucket) => bucket.key === day)?.watchSeconds,
      ).toBe(80);
      expect(
        result.buckets.filter((bucket) => bucket.watchSeconds === 0),
      ).toHaveLength(6);
      expect(period.watchSeconds).toBe(0);
    }
  });

  it('merges normalized work identities across sources and selects latest watched metadata', () => {
    const period = buildPlaybackPeriod({ date: '2026-11-03' });
    const latest = session({
      source: 'b',
      video_id: 'two',
      title: ' ＳＨＯＷ：Ａ ',
      year: ' 2026 ',
      cover: 'new',
      ended_at: instant('2026-11-02T19:00:00Z'),
    });
    const result = aggregatePlaybackPeriod(
      period,
      [
        latest,
        session(),
        session({ year: '2025' }),
        session({ title: 'Other', year: 'unknown' }),
        session({ title: 'Other', year: '' }),
      ],
      300,
    );
    expect(result.topWorks).toHaveLength(3);
    expect(result.topWorks[0]).toEqual({
      source: 'b',
      videoId: 'two',
      title: latest.title,
      year: latest.year,
      cover: 'new',
      watchSeconds: 120,
      sessionCount: 2,
      lastWatchedAt: latest.ended_at,
    });
    expect(result.topWorks[1]).toMatchObject({
      title: 'Other',
      watchSeconds: 120,
      sessionCount: 2,
    });
  });

  it('returns ten works ordered by duration then last watched time', () => {
    const result = aggregatePlaybackPeriod(
      buildPlaybackPeriod({ date: '2026-11-03' }),
      Array.from({ length: 12 }, (_, index) =>
        session({
          title: `Work ${index}`,
          ended_at: instant('2026-11-03T00:00:00Z') + index,
        }),
      ),
      720,
    );
    expect(result.topWorks).toHaveLength(10);
    expect(result.topWorks[0].title).toBe('Work 11');
    expect(result.topWorks[9].title).toBe('Work 2');
  });

  it('counts distinct days rather than monthly buckets in annual reports', () => {
    const result = aggregatePlaybackPeriod(
      buildPlaybackPeriod({ type: 'year', date: '2026-11-03' }),
      [
        session(),
        session({ started_at: instant('2026-11-03T01:00:00Z') }),
        session({ started_at: instant('2026-01-01T01:00:00Z') }),
      ],
      180,
    );
    expect(result.activeDays).toBe(3);
    expect(result.buckets[10].watchSeconds).toBe(120);
    expect(result.buckets[0].watchSeconds).toBe(60);
    expect(result.buckets[11].watchSeconds).toBe(0);
  });
});
