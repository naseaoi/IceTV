import type { AnnualActivityData } from '@/features/playback-stats/types';
import type { VideoReview } from '@/lib/types';

import { aggregateAnnualLists, emptyAnnualActivity } from './annual-activity';
import { aggregateAnnualReport } from './annual-report';
import { publicAnnualReport } from './annual-share';

const at = Date.parse;
const start = at('2024-12-31T16:00:00Z');
const end = at('2025-12-31T16:00:00Z');
function report(
  activity: AnnualActivityData,
  reviews: VideoReview[] = [],
  timeZone = 'Asia/Shanghai',
  now = end,
) {
  return aggregateAnnualReport({
    year: 2025,
    timeZone,
    now,
    data: { sessions: [], buckets: [], earliestStartedAt: null },
    reviews,
    activity,
    retentionDays: 0,
  });
}
const review = (title: string, year: string, rating: number | null) =>
  ({
    title,
    title_norm: title,
    year,
    rating,
    created_at: start,
  }) as VideoReview;

it('uses local half-open year boundaries, all-time normalized identity and later completion ties', () => {
  const activity = emptyAnnualActivity();
  activity.completions = [
    { titleNorm: 'showa', year: '2024', celebratedAt: start },
    { titleNorm: 'b', year: '', celebratedAt: start + 86400000 },
    { titleNorm: 'c', year: '', celebratedAt: end },
    { titleNorm: 'd', year: '', celebratedAt: start - 1 },
  ];
  activity.completionWatches = [
    {
      title: 'Show.A',
      year: '2024',
      cover: 'old',
      firstAt: start - 86400000,
      lastAt: start - 86400000,
    },
    {
      title: 'Show A',
      year: '2024',
      cover: 'new',
      firstAt: start - 1000,
      lastAt: start - 1000,
    },
    {
      title: 'Show A',
      year: '2023',
      cover: 'wrong-year',
      firstAt: 1,
      lastAt: 1,
    },
    { title: 'B', year: '', cover: '', firstAt: start, lastAt: start },
  ];
  const result = report(activity);
  expect(result.completions).toMatchObject({
    count: 2,
    longest: { title: 'B', days: 2 },
    fastest: { title: 'B', days: 2 },
  });
  activity.completions = activity.completions.slice(0, 1);
  expect(report(activity).completions).toEqual({
    count: 1,
    longest: {
      title: 'Show A',
      year: '2024',
      cover: 'new',
      firstWatchedAt: start - 86400000,
      completedAt: start,
      days: 2,
    },
    fastest: null,
  });
  activity.completionWatches = [];
  expect(report(activity).completions).toEqual({
    count: 1,
    longest: null,
    fastest: null,
  });
});

it('counts local natural days across DST rather than elapsed 24-hour periods', () => {
  const activity = emptyAnnualActivity();
  activity.completions = [
    { titleNorm: 'a', year: '', celebratedAt: at('2025-03-10T04:00:00Z') },
  ];
  activity.completionWatches = [
    {
      title: 'A',
      year: '',
      cover: '',
      firstAt: at('2025-03-09T05:00:00Z'),
      lastAt: at('2025-03-09T05:00:00Z'),
    },
  ];
  expect(
    report(activity, [], 'America/New_York').completions.longest?.days,
  ).toBe(2);
  activity.completions[0].celebratedAt = at('2025-03-09T06:00:00Z');
  expect(
    report(activity, [], 'America/New_York').completions.longest?.days,
  ).toBe(1);
});

it('counts additions to old lists and annual likes, filters all public list metrics and preserves ordered covers', () => {
  const activity = emptyAnnualActivity();
  activity.lists = [
    {
      id: 'private',
      name: 'Secret',
      visibility: 0,
      createdAt: start,
      updatedAt: 10,
      itemCount: 9,
    },
    {
      id: 'members',
      name: 'Members',
      visibility: 1,
      createdAt: start - 1,
      updatedAt: 20,
      itemCount: 4,
    },
    {
      id: 'everyone',
      name: 'Everyone',
      visibility: 2,
      createdAt: start,
      updatedAt: 30,
      itemCount: 4,
    },
  ];
  activity.listItems = activity.lists.flatMap((list) =>
    [3, 1, 2, 0].map((position) => ({
      listId: list.id,
      cover: `${position}`,
      position,
      addedAt: position === 0 ? start - 1 : position === 3 ? end : start,
    })),
  );
  activity.likes = [
    { listId: 'private', createdAt: start },
    { listId: 'private', createdAt: start + 1 },
    { listId: 'members', createdAt: start },
    { listId: 'everyone', createdAt: end - 1 },
    { listId: 'members', createdAt: end },
    { listId: 'members', createdAt: start - 1 },
  ];
  const result = report(activity);
  expect(result.lists).toMatchObject({
    createdCount: 2,
    itemCount: 6,
    featured: { id: 'private', likes: 2 },
  });
  const publicReport = publicAnnualReport(result, [], false, activity);
  expect(publicReport).toMatchObject({
    capsules: null,
    social: null,
    completions: result.completions,
    lists: {
      createdCount: 1,
      itemCount: 4,
      featured: {
        id: 'everyone',
        likes: 1,
        itemCount: 4,
        covers: ['0', '1', '2'],
      },
    },
  });
  expect(JSON.stringify(publicReport)).not.toContain('Secret');
  activity.likes = [];
  expect(
    aggregateAnnualLists(activity, start, end, true).featured,
  ).toMatchObject({ id: 'everyone', likes: 0 });
  activity.lists = activity.lists.map((list) => ({ ...list, itemCount: 0 }));
  expect(aggregateAnnualLists(activity, start, end).featured).toBeNull();
});

it('counts written and delivered independently, respects now and matches current ratings with exact-null blocking fallback', () => {
  const activity = emptyAnnualActivity();
  const capsule = (
    title: string,
    createdAt: number,
    deliverAt: number,
    year = '',
  ) => ({ title, year, cover: title, ratingThen: 5, createdAt, deliverAt });
  activity.capsules = [
    capsule('old', start - 1, start),
    capsule('new', start, start + 1),
    capsule('blocked', start, start + 2, '2025'),
    capsule('future', start, end + 1),
    capsule('outside', start - 2, start - 1),
    capsule('end', end, end + 2),
    capsule('notyet', start, start + 100),
  ];
  activity.follows = [start - 1, start, end - 1, end].map((createdAt) => ({
    createdAt,
  }));
  const result = report(
    activity,
    [
      review('old', '', 9),
      review('new', '', 1),
      review('blocked', '', 10),
      review('blocked', '2025', null),
    ],
    'Asia/Shanghai',
    start + 2,
  );
  expect(result.capsules).toEqual({
    written: 4,
    delivered: 3,
    nextDeliverAt: start + 100,
    biggestChange: {
      title: 'new',
      year: '',
      cover: 'new',
      ratingThen: 5,
      ratingNow: 1,
    },
  });
  expect(result.social).toEqual({ newFollowing: 2, topWorkWatchers: 0 });
  expect(report(emptyAnnualActivity()).capsules).toEqual({
    written: 0,
    delivered: 0,
    nextDeliverAt: null,
    biggestChange: null,
  });
});
