import type {
  AnnualActivityData,
  AnnualReport,
  AnnualReportCompletion,
} from '@/features/playback-stats/types';
import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';
import type { VideoReview } from '@/lib/types';

import { localDate } from './period';
import { playbackWorkIdentity } from './work-identity';

export function emptyAnnualActivity(): AnnualActivityData {
  return {
    completions: [],
    completionWatches: [],
    lists: [],
    listItems: [],
    likes: [],
    capsules: [],
    follows: [],
  };
}

export function aggregateAnnualLists(
  activity: AnnualActivityData,
  start: number,
  end: number,
  publicOnly = false,
): AnnualReport['lists'] {
  const within = (at: number) => at >= start && at < end;
  const lists = activity.lists.filter(
    (list) => !publicOnly || list.visibility >= 1,
  );
  const ids = new Set(lists.map((list) => list.id));
  const likeCounts = new Map<string, number>();
  for (const like of activity.likes) {
    if (within(like.createdAt))
      likeCounts.set(like.listId, (likeCounts.get(like.listId) ?? 0) + 1);
  }
  // 年内有人点赞取获赞最多的片单，否则取收录最多的片单
  const top = [...lists]
    .filter((list) => list.itemCount > 0 || likeCounts.has(list.id))
    .sort(
      (a, b) =>
        (likeCounts.get(b.id) ?? 0) - (likeCounts.get(a.id) ?? 0) ||
        b.itemCount - a.itemCount ||
        b.updatedAt - a.updatedAt,
    )[0];
  return {
    createdCount: lists.filter((list) => within(list.createdAt)).length,
    itemCount: activity.listItems.filter(
      (item) => ids.has(item.listId) && within(item.addedAt),
    ).length,
    featured: top
      ? {
          id: top.id,
          name: top.name,
          likes: likeCounts.get(top.id) ?? 0,
          itemCount: top.itemCount,
          covers: activity.listItems
            .filter((item) => item.listId === top.id)
            .sort((a, b) => a.position - b.position)
            .slice(0, 3)
            .map((item) => item.cover),
        }
      : null,
  };
}

export function aggregateAnnualActivity(
  activity: AnnualActivityData,
  reviews: VideoReview[],
  start: number,
  end: number,
  now: number,
  timeZone: string,
): Pick<AnnualReport, 'completions' | 'lists' | 'capsules' | 'social'> {
  const within = (at: number) => at >= start && at < end;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const day = (at: number) =>
    Date.parse(`${localDate(formatter, at)}T00:00:00Z`);
  const watches = new Map<
    string,
    AnnualActivityData['completionWatches'][number]
  >();
  for (const watch of activity.completionWatches) {
    const key = playbackWorkIdentity(watch);
    const previous = watches.get(key);
    watches.set(
      key,
      previous
        ? {
            ...(previous.lastAt > watch.lastAt ? previous : watch),
            firstAt: Math.min(previous.firstAt, watch.firstAt),
          }
        : watch,
    );
  }
  const markers = activity.completions.filter((marker) =>
    within(marker.celebratedAt),
  );
  const completed: AnnualReportCompletion[] = markers.flatMap((marker) => {
    const watch = watches.get(
      playbackWorkIdentity({ title: marker.titleNorm, year: marker.year }),
    );
    // 保留标记计数；统计保留策略清掉所有会话时，不编造首次观看时间或追剧天数。
    if (!watch) return [];
    return [
      {
        title: watch.title,
        year: marker.year,
        cover: watch.cover,
        completedAt: marker.celebratedAt,
        firstWatchedAt: watch.firstAt,
        days: Math.max(
          1,
          Math.round(
            (day(marker.celebratedAt) - day(watch.firstAt)) / 86_400_000,
          ) + 1,
        ),
      },
    ];
  });
  const byLongest = [...completed].sort(
    (a, b) => b.days - a.days || b.completedAt - a.completedAt,
  );
  const byFastest = [...completed].sort(
    (a, b) => a.days - b.days || b.completedAt - a.completedAt,
  );
  const written = activity.capsules.filter((capsule) =>
    within(capsule.createdAt),
  );
  const delivered = activity.capsules.filter(
    (capsule) => within(capsule.deliverAt) && capsule.deliverAt <= now,
  );
  const ratings = new Map(
    reviews.map((review) => [playbackWorkIdentity(review), review.rating]),
  );
  const changes = delivered
    .flatMap((capsule) => {
      const key = playbackWorkIdentity(capsule);
      const fallback = playbackWorkIdentity({
        title: normalizeWorkTitle(capsule.title),
        year: '',
      });
      const ratingNow = ratings.has(key)
        ? ratings.get(key)
        : ratings.get(fallback);
      if (capsule.ratingThen === null || ratingNow == null) return [];
      return [
        {
          ...capsule,
          year: normalizeWorkYear(capsule.year),
          ratingThen: capsule.ratingThen,
          ratingNow,
          delta: Math.abs(capsule.ratingThen - ratingNow),
        },
      ];
    })
    .sort((a, b) => b.delta - a.delta || b.deliverAt - a.deliverAt);
  const change = changes[0];
  const next = written
    .filter((capsule) => capsule.deliverAt > now)
    .sort((a, b) => a.deliverAt - b.deliverAt)[0];
  return {
    completions: {
      count: markers.length,
      longest: byLongest[0] ?? null,
      fastest: markers.length < 2 ? null : (byFastest[0] ?? null),
    },
    lists: aggregateAnnualLists(activity, start, end),
    capsules: {
      written: written.length,
      delivered: delivered.length,
      nextDeliverAt: next?.deliverAt ?? null,
      biggestChange: change
        ? {
            title: change.title,
            year: change.year,
            cover: change.cover,
            ratingThen: change.ratingThen,
            ratingNow: change.ratingNow,
          }
        : null,
    },
    social: {
      newFollowing: activity.follows.filter((follow) =>
        within(follow.createdAt),
      ).length,
      topWorkWatchers: 0,
    },
  };
}
