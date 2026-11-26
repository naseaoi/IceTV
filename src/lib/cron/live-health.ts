import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  getCachedLiveChannels,
  isLiveEntryEnabledInConfig,
} from '@/features/live/lib/live';
import { LIVE_HEALTH_POLICY as POLICY } from '@/features/live/lib/liveHealthPolicy';
import {
  createLiveHealthBudget,
  createLiveHealthHostGate,
  LiveHealthDeferred,
  probeLiveLine,
} from '@/features/live/lib/liveHealthProbe.server';
import {
  isLiveHealthDue,
  pruneLiveHealthSnapshot,
  readLiveHealthSnapshot,
  writeLiveHealthSnapshot,
} from '@/features/live/lib/liveHealthSnapshot.server';
import { getLiveUserAgent } from '@/features/live/lib/liveLineId.server';
import type { LiveChannel } from '@/features/live/types';
import { withTimeout } from '@/lib/concurrency';
import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import { isServerRelayPaused } from '@/lib/host-traffic.server';

const RUN_KEY = 'live-health:run:v1';

export async function probeConfiguredLiveLines(): Promise<void> {
  const token = randomUUID();
  const startedAt = Date.now();
  if (
    !(await db.acquireSharedCacheLease(
      RUN_KEY,
      token,
      startedAt,
      startedAt + POLICY.leaseMs,
    ))
  )
    return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLICY.roundMaxMs);
  const budget = createLiveHealthBudget();
  const context = {
    budget,
    withHost: createLiveHealthHostGate(),
    signal: controller.signal,
  };
  let checked = 0;
  let deferred = 0;
  let writes = Promise.resolve();
  try {
    const config = await getConfigForRead();
    if (
      !isLiveEntryEnabledInConfig(config) ||
      (await isServerRelayPaused(config))
    )
      return;
    const queue: Array<{
      channel: LiveChannel;
      ua: string;
      source: string;
      snapshot: Awaited<ReturnType<typeof readLiveHealthSnapshot>>;
    }> = [];
    const save = (
      source: string,
      snapshot: Awaited<ReturnType<typeof readLiveHealthSnapshot>>,
    ) => {
      const next = writes.then(async () => {
        const now = Date.now();
        // 租约丢失后停止回源和写入；旧实例恢复也不能覆盖新一轮结果。
        if (
          !(await db.renewSharedCacheLease(
            RUN_KEY,
            token,
            now,
            now + POLICY.leaseMs,
          ))
        ) {
          controller.abort();
          throw new LiveHealthDeferred('lease lost');
        }
        await writeLiveHealthSnapshot(source, snapshot);
      });
      writes = next;
      return next;
    };
    for (const source of config.LiveConfig ?? []) {
      if (controller.signal.aborted) break;
      if (source.disabled) continue;
      try {
        const data = await withTimeout(
          getCachedLiveChannels(source.key),
          Math.max(1, POLICY.roundMaxMs - (Date.now() - startedAt)),
          'Live channel inventory timed out',
        );
        if (!data || controller.signal.aborted) continue;
        const previous = await readLiveHealthSnapshot(source.key);
        const snapshot = pruneLiveHealthSnapshot(previous, data.channels);
        if (
          Object.keys(previous.lines).length !==
          Object.keys(snapshot.lines).length
        )
          await save(source.key, snapshot);
        const seen = new Set<string>();
        for (const channel of data.channels) {
          if (
            seen.has(channel.lineId) ||
            !isLiveHealthDue(snapshot.lines[channel.lineId])
          )
            continue;
          seen.add(channel.lineId);
          queue.push({
            channel,
            ua: getLiveUserAgent(source.ua),
            source: source.key,
            snapshot,
          });
        }
      } catch (error) {
        console.warn('[live-health] 读取直播源失败', source.key, error);
      }
    }
    queue.sort(
      (a, b) =>
        (a.snapshot.lines[a.channel.lineId]?.checkedAt ?? 0) -
        (b.snapshot.lines[b.channel.lineId]?.checkedAt ?? 0),
    );
    const worker = async () => {
      while (
        !controller.signal.aborted &&
        budget.reservedBytes + POLICY.playlistMaxBytes <= POLICY.roundMaxBytes
      ) {
        const item = queue.shift();
        if (!item) return;
        const health = await probeLiveLine(item.channel.url, item.ua, context);
        if (!health) {
          deferred++;
          continue;
        }
        item.snapshot.lines[item.channel.lineId] = health;
        await save(item.source, item.snapshot);
        checked++;
      }
    };
    // allSettled 确保任一写库失败后等其他工作者释放正文，再释放全轮租约。
    const results = await Promise.allSettled(
      Array.from({ length: POLICY.concurrency }, () =>
        worker().catch((error) => {
          controller.abort();
          throw error;
        }),
      ),
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  } finally {
    clearTimeout(timer);
    controller.abort();
    await db.releaseSharedCacheLease(RUN_KEY, token);
    console.info('[live-health] round complete', {
      checked,
      deferred,
      reservedBytes: budget.reservedBytes,
      elapsedMs: Date.now() - startedAt,
    });
  }
}
