import type {
  AnnualActivityData,
  AnnualReport,
  AnnualReportWork,
  AnnualReportWorkMoment,
} from '@/features/playback-stats/types';
import { isAnnualReportReleased } from '@/lib/annual-report-window';
import type {
  PlaybackAnnualData,
  PlaybackAnnualSession,
  VideoReview,
} from '@/lib/types';

import {
  aggregateAnnualActivity,
  emptyAnnualActivity,
} from './annual-activity';
import { buildPlaybackPeriod, localDate } from './period';
import { visitWatchIntervals } from './watch-intervals';
import { playbackWorkIdentity } from './work-identity';

const DAY_MS = 86_400_000;
const seconds = (ms: number) => Math.floor(ms / 1000);

type Work = {
  item: AnnualReportWork;
  ms: number;
  episodes: Set<number>;
};
type Day = { ms: number; last: number; works: Map<string, Work> };

function moment(
  session: PlaybackAnnualSession,
  at: number,
): AnnualReportWorkMoment {
  return {
    title: session.title,
    year: session.year,
    cover: session.cover,
    source: session.source,
    videoId: session.video_id,
    at,
  };
}

function addWork(
  works: Map<string, Work>,
  key: string,
  session: PlaybackAnnualSession,
  ms: number,
  first: number,
  last: number,
): void {
  let work = works.get(key);
  if (!work) {
    const { at: _at, ...metadata } = moment(session, last);
    work = {
      item: {
        ...metadata,
        watchSeconds: 0,
        episodeCount: 0,
        firstWatchedAt: first,
        lastWatchedAt: last,
      },
      ms: 0,
      episodes: new Set(),
    };
    works.set(key, work);
  }
  work.ms += ms;
  work.episodes.add(session.episode_index);
  work.item.firstWatchedAt = Math.min(work.item.firstWatchedAt, first);
  if (last >= work.item.lastWatchedAt) {
    const { at: _at, ...metadata } = moment(session, last);
    Object.assign(work.item, metadata, { lastWatchedAt: last });
  }
}

function topWorks(works: Map<string, Work>, limit: number): AnnualReportWork[] {
  return [...works.values()]
    .sort((a, b) => b.ms - a.ms || b.item.lastWatchedAt - a.item.lastWatchedAt)
    .slice(0, limit)
    .map(({ item, ms, episodes }) => ({
      ...item,
      watchSeconds: seconds(ms),
      episodeCount: episodes.size,
    }));
}

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function aggregateAnnualReport(input: {
  year: number;
  timeZone: string;
  now: number;
  data: PlaybackAnnualData;
  reviews: VideoReview[];
  activity?: AnnualActivityData;
  retentionDays: number;
  includeUnreleased?: boolean;
}): AnnualReport {
  const { year, timeZone, now, data, reviews, retentionDays } = input;
  const period = buildPlaybackPeriod(
    { type: 'year', date: `${year}-01-01`, timeZone },
    now,
  );
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const clock = (at: number) => {
    const parts = formatter.formatToParts(at);
    const part = (type: string) =>
      Number(parts.find((value) => value.type === type)!.value);
    return {
      hour: part('hour'),
      minute: part('minute'),
      second: part('second'),
    };
  };
  const months = Array<number>(12).fill(0);
  const hours = Array<number>(24).fill(0);
  const weekdays = Array<number>(7).fill(0);
  const works = new Map<string, Work>();
  const days = new Map<string, Day>();
  const sources = new Map<
    string,
    {
      source: string;
      sourceName: string;
      ms: number;
      last: number;
      works: Set<string>;
    }
  >();
  let totalMs = 0;
  let estimatedMs = 0;
  let lateNightMs = 0;
  let firstWork: AnnualReportWorkMoment | null = null;
  let lastWork: AnnualReportWorkMoment | null = null;
  let latestNight: AnnualReport['latestNight'] = null;
  let latestNightClock = -1;

  const addBucket = (
    session: PlaybackAnnualSession,
    start: number,
    ms: number,
    first: number,
    last: number,
  ) => {
    if (!(ms > 0) || start < period.start || start >= period.end) return;
    const key = playbackWorkIdentity(session);
    const date = localDate(formatter, start);
    const { hour } = clock(start);
    const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
    totalMs += ms;
    if (session.measurement_version === 1) estimatedMs += ms;
    months[Number(date.slice(5, 7)) - 1] += ms;
    hours[hour] += ms;
    weekdays[weekday] += ms;
    if (hour < 5) lateNightMs += ms;
    addWork(works, key, session, ms, first, last);
    let day = days.get(date);
    if (!day) {
      day = { ms: 0, last, works: new Map() };
      days.set(date, day);
    }
    day.ms += ms;
    day.last = Math.max(day.last, last);
    addWork(day.works, key, session, ms, first, last);
    let source = sources.get(session.source);
    if (!source) {
      source = {
        source: session.source,
        sourceName: session.source_name,
        ms: 0,
        last,
        works: new Set(),
      };
      sources.set(session.source, source);
    }
    source.ms += ms;
    source.works.add(key);
    if (last >= source.last) {
      source.last = last;
      source.sourceName = session.source_name;
    }
    if (!firstWork || first < firstWork.at) firstWork = moment(session, first);
    if (!lastWork || last > lastWork.at) lastWork = moment(session, last);
  };

  const sessions = new Map(
    data.sessions.filter((s) => s.watch_seconds > 0).map((s) => [s.id, s]),
  );
  const contributing = visitWatchIntervals(
    data,
    period.start,
    period.end,
    addBucket,
  );
  for (const session of sessions.values()) {
    if (
      !contributing.has(session.id) ||
      session.ended_at < period.start ||
      session.ended_at >= period.end
    )
      continue;
    const { hour, minute, second } = clock(session.ended_at);
    const shifted = ((hour + 19) % 24) * 3600 + minute * 60 + second;
    if (
      shifted > latestNightClock ||
      (shifted === latestNightClock &&
        session.ended_at > (latestNight?.at ?? 0))
    ) {
      latestNightClock = shifted;
      latestNight = {
        ...moment(session, session.ended_at),
        localTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      };
    }
  }

  let longestStreak: AnnualReport['longestStreak'] = null;
  let streak: NonNullable<AnnualReport['longestStreak']> | null = null;
  for (const date of [...days.keys()].sort()) {
    streak =
      streak && nextDate(streak.endDate) === date
        ? { days: streak.days + 1, startDate: streak.startDate, endDate: date }
        : { days: 1, startDate: date, endDate: date };
    if (!longestStreak || streak.days >= longestStreak.days)
      longestStreak = streak;
  }
  const peak = [...days.entries()].sort(
    (a, b) => b[1].ms - a[1].ms || b[1].last - a[1].last,
  )[0];
  const currentYear = Number(localDate(formatter, now).slice(0, 4));
  const earliestYear =
    data.earliestStartedAt === null
      ? currentYear
      : Number(localDate(formatter, data.earliestStartedAt).slice(0, 4));
  const availableYears = new Set([year]);
  for (let y = earliestYear; y <= currentYear; y++) availableYears.add(y);
  const annualReviews = reviews.filter(
    (review) =>
      review.created_at >= period.start && review.created_at < period.end,
  );
  const rated = annualReviews.filter(
    (review): review is VideoReview & { rating: number } =>
      review.rating !== null,
  );
  const topRated = [...rated].sort(
    (a, b) => b.rating - a.rating || b.created_at - a.created_at,
  )[0];
  return {
    ...aggregateAnnualActivity(
      input.activity ?? emptyAnnualActivity(),
      reviews,
      period.start,
      period.end,
      now,
      timeZone,
    ),
    year,
    timeZone,
    generatedAt: now,
    inProgress: now < period.end,
    availableYears: [...availableYears]
      .filter(
        (candidate) =>
          input.includeUnreleased ||
          isAnnualReportReleased(candidate, localDate(formatter, now)),
      )
      .sort((a, b) => b - a),
    possiblyIncomplete:
      retentionDays > 0 && period.start < now - retentionDays * DAY_MS,
    totals: {
      watchSeconds: seconds(totalMs),
      estimatedWatchSeconds: seconds(estimatedMs),
      activeDays: days.size,
      workCount: works.size,
      episodeCount: [...works.values()].reduce(
        (sum, work) => sum + work.episodes.size,
        0,
      ),
      sourceCount: sources.size,
    },
    months: months.map(seconds),
    hours: hours.map(seconds),
    weekdays: weekdays.map(seconds),
    lateNightWatchSeconds: seconds(lateNightMs),
    latestNight,
    peakDay: peak
      ? {
          date: peak[0],
          watchSeconds: seconds(peak[1].ms),
          works: topWorks(peak[1].works, 3),
        }
      : null,
    longestStreak,
    topWorks: topWorks(works, 10),
    topSources: [...sources.values()]
      .sort((a, b) => b.ms - a.ms || b.last - a.last)
      .slice(0, 5)
      .map((source) => ({
        source: source.source,
        sourceName: source.sourceName,
        watchSeconds: seconds(source.ms),
        workCount: source.works.size,
      })),
    firstWork,
    lastWork,
    reviews: {
      count: annualReviews.length,
      ratedCount: rated.length,
      averageRating: rated.length
        ? Math.round(
            (rated.reduce((sum, review) => sum + review.rating, 0) /
              rated.length) *
              10,
          ) / 10
        : null,
      topRated: topRated
        ? {
            title: topRated.title,
            year: topRated.year,
            cover: topRated.cover,
            rating: topRated.rating,
          }
        : null,
    },
  };
}
