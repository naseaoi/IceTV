import {
  type SearchAggregationOptions,
  collectSearchAggregation,
} from '@/lib/search-aggregate';
import {
  type SearchAggregateCacheParams,
  makeSearchAggregateCacheKey,
  mergeRetriedSearchAggregate,
  persistCachedSearchAggregate,
} from '@/lib/search-cache';
import { ResourceLimitError } from '@/lib/server-resource-errors';

const MAX_TASKS = 64;
const MAX_SUBSCRIBERS = 384;
const MAX_TASK_BYTES = 16 * 1024 * 1024;
const MAX_REPLAY_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();

type Subscriber = { wake: () => void };
type SearchTask = {
  abort: AbortController;
  subscribers: Set<Subscriber>;
  frames: Uint8Array[];
  bytes: number;
  done: boolean;
  error?: unknown;
};
const tasks = new Map<string, SearchTask>();
let subscriberCount = 0;
let replayBytes = 0;

// 事件仅序列化一次；消费者用游标读取共享回放，ReadableStream 自身不预取。
export function createSharedSearchStream(
  options: SearchAggregationOptions,
  cacheParams: SearchAggregateCacheParams,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  if (subscriberCount >= MAX_SUBSCRIBERS) throw new ResourceLimitError(503, 1);
  const key = JSON.stringify([
    makeSearchAggregateCacheKey(cacheParams),
    options.retryFailed ? options.apiSites.map((site) => site.key) : null,
  ]);
  let task = tasks.get(key);
  const isNew = !task;
  if (!task) {
    if (tasks.size >= MAX_TASKS) throw new ResourceLimitError(503, 1);
    task = {
      abort: new AbortController(),
      subscribers: new Set(),
      frames: [],
      bytes: 0,
      done: false,
    };
    tasks.set(key, task);
  }
  const shared = task;
  let cursor = 0;
  let detached = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const subscriber: Subscriber = { wake: () => {} };
  shared.subscribers.add(subscriber);
  subscriberCount++;

  const removeTask = () => {
    if (tasks.get(key) === shared) tasks.delete(key);
  };
  const detach = () => {
    if (detached) return;
    detached = true;
    signal.removeEventListener('abort', onAbort);
    shared.subscribers.delete(subscriber);
    subscriberCount--;
    subscriber.wake();
    if (shared.subscribers.size === 0) {
      removeTask();
      shared.abort.abort();
      replayBytes -= shared.bytes;
      shared.bytes = 0;
      shared.frames = [];
    }
  };
  const onAbort = () => {
    if (detached) return;
    detach();
    controller.close();
  };
  const stream = new ReadableStream<Uint8Array>(
    {
      start(streamController) {
        controller = streamController;
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      },
      async pull() {
        while (!detached) {
          if (cursor < shared.frames.length) {
            controller.enqueue(shared.frames[cursor++]);
            return;
          }
          if (shared.done) {
            detach();
            if (shared.error) controller.error(shared.error);
            else controller.close();
            return;
          }
          await new Promise<void>((resolve) => {
            subscriber.wake = resolve;
          });
        }
      },
      cancel: detach,
    },
    { highWaterMark: 0 },
  );

  if (isNew) {
    const publish = (event: Record<string, unknown>) => {
      if (shared.abort.signal.aborted) return;
      const frame = encoder.encode(
        `data: ${JSON.stringify({ ...event, timestamp: Date.now() })}\n\n`,
      );
      if (
        shared.bytes + frame.byteLength > MAX_TASK_BYTES ||
        replayBytes + frame.byteLength > MAX_REPLAY_BYTES
      ) {
        shared.error = new ResourceLimitError(503, 1);
        shared.abort.abort();
        throw shared.error;
      }
      shared.frames.push(frame);
      shared.bytes += frame.byteLength;
      replayBytes += frame.byteLength;
      shared.subscribers.forEach((consumer) => consumer.wake());
    };
    void (async () => {
      try {
        if (shared.abort.signal.aborted) return;
        publish({
          type: 'start',
          query: options.query,
          totalSources: options.apiSites.length,
        });
        let completedSources = 0;
        const aggregate = await collectSearchAggregation({
          ...options,
          signal: shared.abort.signal,
          shouldContinue: () => !shared.abort.signal.aborted,
          onSourceResult: (site, results) => {
            completedSources++;
            publish({
              type: 'source_result',
              source: site.key,
              sourceName: site.name,
              results,
            });
          },
          onSourceError: (site, error) => {
            completedSources++;
            if (shared.abort.signal.aborted) return;
            console.error('流式搜索源请求失败:', site.key, error);
            publish({
              type: 'source_error',
              source: site.key,
              sourceName: site.name,
              error: '搜索失败',
            });
          },
        });
        if (shared.abort.signal.aborted) return;
        if (options.retryFailed) {
          mergeRetriedSearchAggregate(
            cacheParams,
            new Set(options.apiSites.map((site) => site.key)),
            aggregate,
          );
        } else {
          await persistCachedSearchAggregate(cacheParams, aggregate);
        }
        publish({
          type: 'complete',
          totalResults: aggregate.results.length,
          completedSources,
        });
      } catch (error) {
        shared.error = error;
        shared.abort.abort();
      } finally {
        shared.done = true;
        removeTask();
        shared.subscribers.forEach((consumer) => consumer.wake());
      }
    })();
  }
  return stream;
}
