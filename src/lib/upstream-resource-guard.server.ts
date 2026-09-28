import 'server-only';

import { randomUUID } from 'node:crypto';

import { ResourceLimitError } from '@/lib/server-resource-errors';
import {
  consumeSharedQuota,
  resourceKey,
  sharedResourceStore,
} from '@/lib/shared-resource-quota.server';
import type { SharedResourceStore } from '@/lib/shared-resource-store';
import {
  type UpstreamResourceContext,
  upstreamResourcePolicy,
} from '@/lib/upstream-resource-policy';

const LEASE_MS = 30_000;

export async function withUpstreamTask<T>(
  url: string,
  task: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  let result: T;
  await withUpstreamResponse(
    url,
    async (guardSignal) => {
      result = await task(guardSignal);
      return new Response(null, { status: 204 });
    },
    { signal },
  );
  return result!;
}

export interface UpstreamGuardOptions extends UpstreamResourceContext {
  signal?: AbortSignal | null;
  store?: SharedResourceStore;
}

export async function withUpstreamResponse(
  url: string,
  loader: (signal: AbortSignal) => Promise<Response>,
  options: UpstreamGuardOptions = {},
): Promise<Response> {
  const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  const kind = options.kind ?? 'metadata';
  const policy = upstreamResourcePolicy(kind);
  const scope =
    kind === 'probe' ? 'probe' : kind === 'metadata' ? 'metadata' : 'media';
  const store = options.store ?? (await sharedResourceStore());
  const token = randomUUID();
  const leases: string[] = [];
  const abortController = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let releasePromise: Promise<void> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let renewing = false;
  let terminated = false;
  let prepaidBytes = 0;
  const byteQuotas: Array<[string, number, 429 | 503]> = [];
  if (policy.globalBytes) {
    byteQuotas.push(
      [resourceKey('bytes:media:global', 'all'), policy.globalBytes, 503],
      [resourceKey('bytes:media:host', host), policy.hostBytes, 503],
    );
    if (options.identity)
      byteQuotas.push([
        resourceKey('bytes:media:user', options.identity),
        policy.userBytes,
        429,
      ]);
  }

  function release(): Promise<void> {
    if (!releasePromise) {
      clearInterval(heartbeat);
      clearTimeout(deadline);
      options.signal?.removeEventListener('abort', abortFromParent);
      releasePromise = Promise.all(
        leases.map((key) => store.release(key, token).catch(() => {})),
      ).then(() => {});
    }
    return releasePromise;
  }

  async function abort(reason: unknown) {
    if (terminated) return;
    terminated = true;
    abortController.abort(reason);
    if (reader) {
      await reader.cancel(reason).catch(() => {});
      await release();
      streamController?.error(reason);
    } else if (heartbeat) {
      // 准入完成才启动心跳，此后不再新增租约，上游未响应也可直接释放；准入中途的中止由主流程 catch 统一释放
      await release();
    }
  }

  function abortFromParent() {
    void abort(options.signal?.reason ?? new Error('Request aborted'));
  }

  async function acquire(
    dimension: string,
    identity: string,
    limit: number,
    status: 429 | 503 = 503,
  ) {
    const key = resourceKey(`connections:${scope}:${dimension}`, identity);
    const now = Date.now();
    const admission = await store
      .acquire(key, token, limit, now, now + LEASE_MS)
      .catch(() => {
        throw new ResourceLimitError();
      });
    if (!admission.allowed)
      throw new ResourceLimitError(
        status,
        kind === 'probe' ? 2 : admission.retryAfterMs / 1000,
      );
    leases.push(key);
  }

  async function reserveBytes(bytes: number) {
    const prepaid = Math.min(prepaidBytes, bytes);
    prepaidBytes -= prepaid;
    if (bytes === prepaid) return;
    for (const [key, limit, status] of byteQuotas)
      await consumeSharedQuota(
        store,
        key,
        bytes - prepaid,
        limit,
        status,
        'bytes',
      );
  }

  try {
    if (options.signal?.aborted)
      throw options.signal.reason ?? new Error('Request aborted');
    options.signal?.addEventListener('abort', abortFromParent, { once: true });
    await acquire('global', 'all', policy.globalConcurrency);
    await acquire('host', host, policy.hostConcurrency);
    if (kind === 'live') await acquire('live', 'all', policy.liveConcurrency);
    if (options.identity && kind !== 'metadata')
      await acquire('user', options.identity, policy.userConcurrency, 429);
    await consumeSharedQuota(
      store,
      resourceKey(`rpm:${scope}:global`, 'all'),
      1,
      policy.globalRpm,
    );
    await consumeSharedQuota(
      store,
      resourceKey(`rpm:${scope}:host`, host),
      1,
      policy.hostRpm,
    );
    heartbeat = setInterval(async () => {
      if (renewing || releasePromise) return;
      renewing = true;
      try {
        const now = Date.now();
        const renewed = await Promise.all(
          leases.map((key) => store.renew(key, token, now, now + LEASE_MS)),
        );
        if (renewed.some((owned) => !owned))
          await abort(new ResourceLimitError());
      } catch {
        await abort(new ResourceLimitError());
      } finally {
        renewing = false;
      }
    }, LEASE_MS / 3);
    heartbeat.unref?.();
    deadline = setTimeout(() => {
      void abort(new ResourceLimitError());
    }, policy.maxDurationMs);
    deadline.unref?.();
    // 准入预扣正文首字节，无流量额度时不建立上游连接；首个数据块抵扣这 1 字节
    await reserveBytes(1);
    prepaidBytes = 1;
    if (abortController.signal.aborted) throw abortController.signal.reason;
    const response = await loader(abortController.signal);
    if (abortController.signal.aborted) {
      await response.body?.cancel();
      throw abortController.signal.reason;
    }
    if (!response.body) {
      terminated = true;
      await release();
      return response;
    }
    reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>(
      {
        start(current) {
          streamController = current;
        },
        async pull(current) {
          try {
            const chunk = await reader!.read();
            if (terminated) return;
            if (chunk.done) {
              terminated = true;
              await release();
              current.close();
              return;
            }
            await reserveBytes(chunk.value.byteLength);
            if (!terminated) current.enqueue(chunk.value);
          } catch (error) {
            await abort(error);
          }
        },
        async cancel(reason) {
          terminated = true;
          abortController.abort(reason);
          await reader!.cancel(reason).catch(() => {});
          await release();
        },
      },
      { highWaterMark: 0 },
    );
    const guarded = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperties(guarded, {
      url: { value: response.url },
      redirected: { value: response.redirected },
    });
    return guarded;
  } catch (error) {
    abortController.abort(error);
    await reader?.cancel(error).catch(() => {});
    await release();
    throw error;
  }
}
