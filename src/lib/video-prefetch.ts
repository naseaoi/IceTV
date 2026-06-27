import { preloadPlayerModules } from '@/lib/player-runtime';

const prefetchedDetails = new Set<string>();
const PREFETCH_DETAIL_MAX = 200;
const PREFETCH_DETAIL_CONCURRENCY = 3;
const PREFETCH_DETAIL_QUEUE_MAX = 20;

let activeDetailPrefetches = 0;
const detailPrefetchQueue: Array<{
  key: string;
  run: () => Promise<void>;
}> = [];

function trimIfNeeded() {
  if (prefetchedDetails.size <= PREFETCH_DETAIL_MAX) return;
  const iter = prefetchedDetails.values();
  const toRemove = Math.floor(PREFETCH_DETAIL_MAX / 2);
  for (let i = 0; i < toRemove; i++) {
    const next = iter.next();
    if (next.done) break;
    prefetchedDetails.delete(next.value);
  }
}

function drainDetailPrefetchQueue() {
  while (
    activeDetailPrefetches < PREFETCH_DETAIL_CONCURRENCY &&
    detailPrefetchQueue.length > 0
  ) {
    const task = detailPrefetchQueue.shift();
    if (!task) return;

    activeDetailPrefetches += 1;
    task.run().finally(() => {
      activeDetailPrefetches -= 1;
      drainDetailPrefetchQueue();
    });
  }
}

function prefetchVideoDetail(
  source: string | undefined,
  id: string | undefined,
): void {
  if (!source || !id) return;
  const key = `${source}::${id}`;
  if (prefetchedDetails.has(key)) return;

  prefetchedDetails.add(key);
  trimIfNeeded();

  if (detailPrefetchQueue.length >= PREFETCH_DETAIL_QUEUE_MAX) {
    const dropped = detailPrefetchQueue.shift();
    if (dropped) {
      prefetchedDetails.delete(dropped.key);
    }
  }

  detailPrefetchQueue.push({
    key,
    run: async () => {
      await fetch(
        `/api/detail?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`,
        { credentials: 'same-origin' },
      ).catch(() => {
        prefetchedDetails.delete(key);
      });
    },
  });
  drainDetailPrefetchQueue();
}

export function warmupForPlayback(
  source: string | undefined,
  id: string | undefined,
): void {
  preloadPlayerModules();
  prefetchVideoDetail(source, id);
}
