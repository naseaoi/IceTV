import type {
  PlaybackAnnualData,
  PlaybackAnnualSession,
  VideoReview,
} from '@/lib/types';

import { aggregateAnnualReport } from './annual-report';

const at = Date.parse;
function session(
  id: string,
  start: string,
  changes: Partial<PlaybackAnnualSession> = {},
): PlaybackAnnualSession {
  return {
    id,
    source: 'a',
    video_id: id,
    episode_index: 1,
    title: 'Show',
    source_name: 'Source A',
    cover: '',
    year: '2025',
    started_at: at(start),
    ended_at: at(start) + 60000,
    watch_seconds: 60,
    measurement_version: 2,
    ...changes,
  };
}
function report(
  data: PlaybackAnnualData,
  timeZone = 'UTC',
  reviews: VideoReview[] = [],
) {
  return aggregateAnnualReport({
    year: 2025,
    timeZone,
    now: at('2026-01-01T12:00:00Z'),
    data,
    reviews,
    retentionDays: 365,
  });
}
function data(
  sessions: PlaybackAnnualSession[],
  buckets = sessions.map((s) => ({
    session_id: s.id,
    bucket_start: Math.floor(s.started_at / 900000) * 900000,
    watch_ms: s.watch_seconds * 1000,
  })),
): PlaybackAnnualData {
  return {
    sessions,
    buckets,
    earliestStartedAt: sessions.length
      ? Math.min(...sessions.map((s) => s.started_at))
      : null,
  };
}

it('returns an empty report with complete histogram shapes', () => {
  const result = report(data([]));
  expect(result.totals).toEqual({
    watchSeconds: 0,
    estimatedWatchSeconds: 0,
    activeDays: 0,
    workCount: 0,
    episodeCount: 0,
    sourceCount: 0,
  });
  expect(result.months).toEqual(Array(12).fill(0));
  expect(result.hours).toEqual(Array(24).fill(0));
  expect(result.weekdays).toEqual(Array(7).fill(0));
  expect([
    result.firstWork,
    result.lastWork,
    result.peakDay,
    result.latestNight,
    result.longestStreak,
    result.reviews.averageRating,
  ]).toEqual(Array(6).fill(null));
  expect(result.availableYears).toEqual([2025]);
});

it('derives available years from the earliest local year even before the requested year', () => {
  const result = report(
    { ...data([]), earliestStartedAt: at('2023-12-31T20:00:00Z') },
    'Asia/Shanghai',
  );
  expect(result.availableYears).toEqual([2025, 2024]);
});

it('splits actual buckets across Shanghai midnight and clips the local year', () => {
  const s = session('midnight', '2025-01-01T15:45:00Z', {
    ended_at: at('2025-01-01T16:30:00Z'),
    watch_seconds: 1800,
  });
  const result = report(
    data(
      [s],
      [
        {
          session_id: s.id,
          bucket_start: at('2024-12-31T15:45:00Z'),
          watch_ms: 900000,
        },
        {
          session_id: s.id,
          bucket_start: at('2025-01-01T15:45:00Z'),
          watch_ms: 900000,
        },
        {
          session_id: s.id,
          bucket_start: at('2025-01-01T16:00:00Z'),
          watch_ms: 900000,
        },
        {
          session_id: s.id,
          bucket_start: at('2025-12-31T16:00:00Z'),
          watch_ms: 900000,
        },
      ],
    ),
    'Asia/Shanghai',
  );
  expect(result.totals.watchSeconds).toBe(1800);
  expect(result.totals.activeDays).toBe(2);
  expect(result.hours[23]).toBe(900);
  expect(result.hours[0]).toBe(900);
  expect(result.lateNightWatchSeconds).toBe(900);
  expect(result.longestStreak).toEqual({
    days: 2,
    startDate: '2025-01-01',
    endDate: '2025-01-02',
  });
  expect(result.peakDay?.date).toBe('2025-01-02');
});

it('spreads legacy sessions into UTC buckets and clips both year boundaries', () => {
  const before = session('before', '2024-12-31T23:59:30Z', {
    measurement_version: 1,
    watch_seconds: 120,
  });
  const after = session('after', '2025-12-31T23:59:30Z', {
    measurement_version: 1,
    watch_seconds: 120,
  });
  const result = report(data([before, after], []));
  expect(result.totals.watchSeconds).toBe(120);
  expect(result.totals.estimatedWatchSeconds).toBe(120);
  expect(result.months[0]).toBe(90);
  expect(result.months[11]).toBe(30);
  expect(result.firstWork?.at).toBe(at('2025-01-01T00:00:00Z'));
  expect(result.lastWork?.at).toBe(at('2026-01-01T00:00:00Z'));
  expect(result.availableYears).toEqual([2025, 2024]);
});

it.each([
  [
    '2025-03-08T17:00:00Z',
    '2025-03-09T16:00:00Z',
    '2025-03-10T16:00:00Z',
    '2025-03-08',
    '2025-03-10',
  ],
  [
    '2025-11-01T16:00:00Z',
    '2025-11-02T17:00:00Z',
    '2025-11-03T17:00:00Z',
    '2025-11-01',
    '2025-11-03',
  ],
])(
  'counts consecutive calendar dates across New York DST %s',
  (a, b, c, startDate, endDate) => {
    const result = report(
      data([session('a', a), session('b', b), session('c', c)]),
      'America/New_York',
    );
    expect(result.longestStreak).toEqual({ days: 3, startDate, endDate });
    expect(result.hours[12]).toBe(180);
  },
);

it('merges works and episodes across sources and takes latest metadata', () => {
  const result = report(
    data([
      session('a', '2025-02-01T10:00:00Z'),
      session('b', '2025-02-02T10:00:00Z', {
        title: 'SHOW',
        source: 'b',
        source_name: 'New source',
        cover: 'new',
      }),
      session('c', '2025-02-03T10:00:00Z', { episode_index: 2 }),
      session('zero', '2025-02-04T10:00:00Z', {
        watch_seconds: 0,
        title: 'Zero',
      }),
    ]),
  );
  expect(result.totals).toMatchObject({
    watchSeconds: 180,
    workCount: 1,
    episodeCount: 2,
    sourceCount: 2,
  });
  expect(result.topWorks[0]).toMatchObject({
    videoId: 'c',
    episodeCount: 2,
    watchSeconds: 180,
  });
  expect(result.topSources.map((s) => s.source)).toEqual(['a', 'b']);
  expect(result.firstWork?.videoId).toBe('a');
  expect(result.lastWork?.videoId).toBe('c');
});

it('compares latest night across midnight with a 05:00 cutoff', () => {
  const result = report(
    data([
      session('late', '2025-02-01T23:00:00Z', {
        ended_at: at('2025-02-01T23:50:00Z'),
      }),
      session('night', '2025-02-02T02:00:00Z', {
        ended_at: at('2025-02-02T04:30:00Z'),
      }),
      session('morning', '2025-02-03T05:00:00Z', {
        ended_at: at('2025-02-03T05:30:00Z'),
      }),
      session('outside', '2025-12-31T23:45:00Z', {
        ended_at: at('2026-01-01T04:59:00Z'),
      }),
    ]),
  );
  expect(result.latestNight).toMatchObject({
    videoId: 'night',
    localTime: '04:30',
  });
});

it('floors after millisecond aggregation and assigns non-hour-offset buckets by local start', () => {
  const s = session('a', '2025-01-01T18:15:00Z');
  const result = report(
    data(
      [s],
      [
        {
          session_id: s.id,
          bucket_start: at('2025-01-01T18:15:00Z'),
          watch_ms: 600,
        },
        {
          session_id: s.id,
          bucket_start: at('2025-01-01T18:30:00Z'),
          watch_ms: 600,
        },
      ],
    ),
    'Asia/Kathmandu',
  );
  expect(result.totals.watchSeconds).toBe(1);
  expect(result.hours[0]).toBe(1);
  expect(result.peakDay?.date).toBe('2025-01-02');
});

it('uses review creation dates, rating tie recency, and retention metadata', () => {
  const review: VideoReview = {
    title_norm: 'show',
    title: 'Show',
    year: '2025',
    cover: '',
    douban_id: 0,
    rating: 8.1,
    content: '',
    is_public: false,
    source_key: '',
    created_at: at('2025-02-01T00:00:00Z'),
    updated_at: at('2026-01-01T00:00:00Z'),
  };
  const result = report(data([]), 'UTC', [
    review,
    { ...review, title: 'New', created_at: review.created_at + 1 },
    { ...review, rating: 7 },
    { ...review, rating: null },
    { ...review, created_at: at('2024-12-31T23:59:59Z') },
  ]);
  expect(result.reviews).toMatchObject({
    count: 4,
    ratedCount: 3,
    averageRating: 7.7,
    topRated: { title: 'New' },
  });
  expect(result.possiblyIncomplete).toBe(true);
  expect(result.inProgress).toBe(false);
  const ongoing = aggregateAnnualReport({
    year: 2025,
    timeZone: 'UTC',
    now: at('2025-06-01T00:00:00Z'),
    data: data([]),
    reviews: [],
    retentionDays: 0,
  });
  expect(ongoing.inProgress).toBe(true);
  expect(ongoing.possiblyIncomplete).toBe(false);
});

it('limits rankings and breaks equal watch durations by recency', () => {
  const rows = Array.from({ length: 12 }, (_, i) =>
    session(`${i}`, `2025-01-01T${String(i).padStart(2, '0')}:00:00Z`, {
      title: `Work ${i}`,
      source: `${i}`,
    }),
  );
  const result = report(data(rows));
  expect(result.topWorks).toHaveLength(10);
  expect(result.topWorks[0].videoId).toBe('11');
  expect(result.topSources).toHaveLength(5);
  expect(result.topSources[0].source).toBe('11');
  expect(result.peakDay?.works.map((work) => work.videoId)).toEqual([
    '11',
    '10',
    '9',
  ]);
});

it('keeps preview explicit and filters available years by local release date', () => {
  const input = {
    year: 2025,
    timeZone: 'UTC',
    now: at('2026-12-19T16:00:00Z'),
    data: data([]),
    reviews: [],
    retentionDays: 0,
  };
  expect(aggregateAnnualReport(input).availableYears).toEqual([2025]);
  expect(
    aggregateAnnualReport({ ...input, includeUnreleased: true }).availableYears,
  ).toEqual([2026, 2025]);
  expect(
    aggregateAnnualReport({ ...input, timeZone: 'Asia/Shanghai' })
      .availableYears,
  ).toEqual([2026, 2025]);
});
