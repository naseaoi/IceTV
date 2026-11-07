/** @jest-environment node */

import type Database from 'better-sqlite3';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { db } from '@/lib/db';
import {
  ResourceLimitError,
  resourceLimitResponse,
} from '@/lib/server-resource-errors';
import type { SharedResourceStore } from '@/lib/shared-resource-store';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import { SqliteResourceStore } from '@/lib/sqlite-resource-store';
import { withUpstreamResponse } from '@/lib/upstream-resource-guard.server';
import { UPSTREAM_COOLDOWN_POLICY } from '@/lib/upstream-resource-policy';

jest.unmock('@/lib/upstream-resource-guard.server');
installStreamPolyfills();

describe('upstream resources', () => {
  let storage: LocalSqliteStorage;
  let store: SharedResourceStore;
  const initialEnv = { ...process.env };

  beforeEach(() => {
    storage = new LocalSqliteStorage(':memory:');
    store = storage.resources;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    for (const key of Object.keys(process.env))
      if (key.startsWith('UPSTREAM_') || key.startsWith('SOURCE_PROBE_'))
        delete process.env[key];
    for (const [key, value] of Object.entries(initialEnv))
      if (key.startsWith('UPSTREAM_') || key.startsWith('SOURCE_PROBE_'))
        process.env[key] = value;
    (storage as unknown as { db: Database.Database }).db.close();
  });

  const loader = () => Promise.resolve(new Response(new Uint8Array(16)));
  const leaseCount = () =>
    (
      (storage as unknown as { db: Database.Database }).db
        .prepare('SELECT COUNT(*) AS total FROM shared_resource_leases')
        .get() as { total: number }
    ).total;

  describe('host cooldown', () => {
    const now = Date.parse('2026-11-07T12:00:00Z');
    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(now);
      jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    function limited(status = 429, retryAfter?: string) {
      return new Response(null, {
        status,
        headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter },
      });
    }

    it('cancels the triggering body, releases leases and refuses before any admission', async () => {
      const cancel = jest.fn().mockRejectedValue(new Error('cancel failed'));
      const origin = jest.fn(
        async () =>
          new Response(new ReadableStream({ cancel }), { status: 429 }),
      );
      const failure = await withUpstreamResponse(
        'https://UP.example.:8443/a',
        origin,
        { store },
      ).catch((error) => error);
      expect(failure).toBeInstanceOf(ResourceLimitError);
      expect(resourceLimitResponse(failure)?.status).toBe(503);
      expect(resourceLimitResponse(failure)?.headers.get('Retry-After')).toBe(
        '30',
      );
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(leaseCount()).toBe(0);
      const acquire = jest.spyOn(store, 'acquire');
      const consume = jest.spyOn(store, 'consume');
      const read = jest.spyOn(store, 'getCooldown');
      jest.mocked(Date.now).mockReturnValue(now + 1200);
      await expect(
        withUpstreamResponse('http://up.example/b', origin, {
          store,
          kind: 'live',
          identity: 'other',
        }),
      ).rejects.toMatchObject({ status: 503, retryAfterSeconds: 29 });
      expect(origin).toHaveBeenCalledTimes(1);
      expect(acquire).not.toHaveBeenCalled();
      expect(consume).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith('Upstream host cooldown', {
        host: 'up.example',
        seconds: 30,
        status: 429,
      });
    });

    it.each([
      [undefined, 30],
      ['invalid', 30],
      ['', 30],
      ['20', 20],
      ['0', 5],
      ['-4', 5],
      ['1.2', 5],
      ['900', 300],
      ['Sat, 07 Nov 2026 12:00:42 GMT', 42],
      ['Sat, 07 Nov 2026 11:59:00 GMT', 5],
      ['Sat, 07 Nov 2026 13:00:00 GMT', 300],
    ])('normalizes Retry-After %s to %s seconds', async (value, expected) => {
      await expect(
        withUpstreamResponse(
          'https://up.example/a',
          async () => limited(429, value),
          { store },
        ),
      ).rejects.toMatchObject({ status: 503, retryAfterSeconds: expected });
    });

    it('cools 503 with Retry-After but preserves other error responses', async () => {
      for (const status of [403, 500, 503]) {
        const response = await withUpstreamResponse(
          'https://up.example/a',
          async () => limited(status),
          { store },
        );
        expect(response.status).toBe(status);
      }
      await expect(
        withUpstreamResponse(
          'https://up.example/a',
          async () => limited(503, '15'),
          { store },
        ),
      ).rejects.toMatchObject({ status: 503, retryAfterSeconds: 15 });
    });

    it('isolates hosts and restores upstream access on expiry', async () => {
      await expect(
        withUpstreamResponse(
          'https://up.example/a',
          async () => limited(429, '5'),
          { store },
        ),
      ).rejects.toMatchObject({ retryAfterSeconds: 5 });
      await (
        await withUpstreamResponse('https://other.example/a', loader, { store })
      ).body!.cancel();
      jest.mocked(Date.now).mockReturnValue(now + 5000);
      const origin = jest.fn(loader);
      await (
        await withUpstreamResponse('https://up.example/a', origin, { store })
      ).body!.cancel();
      expect(origin).toHaveBeenCalledTimes(1);
    });

    it('shares cooldown across store instances while caching misses for three seconds', async () => {
      const other = new SqliteResourceStore(
        (storage as unknown as { db: Database.Database }).db,
      );
      const read = jest.spyOn(other, 'getCooldown');
      const origin = jest.fn(loader);
      await Promise.all(
        Array.from({ length: 4 }, async () =>
          (
            await withUpstreamResponse('https://up.example/a', origin, {
              store: other,
            })
          ).body!.cancel(),
        ),
      );
      expect(read).toHaveBeenCalledTimes(1);
      await expect(
        withUpstreamResponse('https://up.example/a', async () => limited(), {
          store,
        }),
      ).rejects.toMatchObject({ retryAfterSeconds: 30 });
      await (
        await withUpstreamResponse('https://up.example/a', origin, {
          store: other,
        })
      ).body!.cancel();
      expect(read).toHaveBeenCalledTimes(1);
      jest
        .mocked(Date.now)
        .mockReturnValue(now + UPSTREAM_COOLDOWN_POLICY.negativeCacheMs);
      await expect(
        withUpstreamResponse('https://up.example/a', origin, { store: other }),
      ).rejects.toMatchObject({ status: 503, retryAfterSeconds: 27 });
      expect(read).toHaveBeenCalledTimes(2);
      expect(origin).toHaveBeenCalledTimes(5);
    });

    it('keeps longer cooldowns when concurrent responses arrive out of order', async () => {
      const other = new SqliteResourceStore(
        (storage as unknown as { db: Database.Database }).db,
      );
      let respond!: (response: Response) => void;
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const pending = withUpstreamResponse(
        'https://up.example/a',
        () => {
          started();
          return new Promise<Response>((resolve) => {
            respond = resolve;
          });
        },
        { store: other },
      );
      await ready;
      await expect(
        withUpstreamResponse(
          'https://up.example/b',
          async () => limited(429, '120'),
          { store },
        ),
      ).rejects.toMatchObject({ retryAfterSeconds: 120 });
      respond(limited(429, '5'));
      await expect(pending).rejects.toMatchObject({ retryAfterSeconds: 120 });
      await expect(
        withUpstreamResponse('https://up.example/c', loader, { store: other }),
      ).rejects.toMatchObject({ retryAfterSeconds: 120 });
    });

    it('retains local cooldown and normal upstream access on cooldown storage failures', async () => {
      jest
        .spyOn(store, 'getCooldown')
        .mockRejectedValue(new Error('read failed'));
      jest
        .spyOn(store, 'extendCooldown')
        .mockRejectedValue(new Error('write failed'));
      await (
        await withUpstreamResponse('https://other.example/a', loader, { store })
      ).body!.cancel();
      await expect(
        withUpstreamResponse('https://up.example/a', async () => limited(), {
          store,
        }),
      ).rejects.toMatchObject({ retryAfterSeconds: 30 });
      const origin = jest.fn(loader);
      await expect(
        withUpstreamResponse('https://up.example/a', origin, { store }),
      ).rejects.toMatchObject({ retryAfterSeconds: 30 });
      expect(origin).not.toHaveBeenCalled();
    });
  });

  it('caps fifteen concurrent probe users at eight without consuming playback slots', async () => {
    const probeLoader = jest.fn(loader);
    const results = await Promise.allSettled(
      Array.from({ length: 15 }, (_, index) =>
        withUpstreamResponse(
          'http://localhost/api/proxy/segment',
          probeLoader,
          {
            store,
            kind: 'probe',
            identity: `user:${index}`,
          },
        ),
      ),
    );
    const responses = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    expect(responses).toHaveLength(8);
    expect(probeLoader).toHaveBeenCalledTimes(8);
    for (const result of results) {
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({
          status: 503,
          retryAfterSeconds: 2,
        });
    }
    const playback = await withUpstreamResponse(
      'https://up.example/segment',
      loader,
      { store, kind: 'vod', identity: 'user:0' },
    );
    await playback.body!.cancel();
    await responses[0].body!.cancel();
    const replacement = await withUpstreamResponse(
      'http://localhost/api/detail',
      loader,
      { store, kind: 'probe', identity: 'user:new' },
    );
    await replacement.arrayBuffer();
    await Promise.all(
      responses.slice(1).map((response) => response.body!.cancel()),
    );
  });

  it('caps one probe user at two and rolls back refused global leases', async () => {
    const options = { store, kind: 'probe' as const, identity: 'user:one' };
    const first = await withUpstreamResponse(
      'http://localhost/api/detail',
      loader,
      options,
    );
    const second = await withUpstreamResponse(
      'http://localhost/api/detail',
      loader,
      options,
    );
    await expect(
      withUpstreamResponse('http://localhost/api/detail', loader, options),
    ).rejects.toMatchObject({ status: 429 });
    await first.body!.cancel();
    const replacement = await withUpstreamResponse(
      'http://localhost/api/detail',
      loader,
      options,
    );
    await Promise.all([second.body!.cancel(), replacement.body!.cancel()]);
  });

  it('applies a separate shared probe request rate', async () => {
    process.env.SOURCE_PROBE_RPM = '1';
    const options = { store, kind: 'probe' as const, identity: 'user:one' };
    await (
      await withUpstreamResponse('http://localhost/api/detail', loader, options)
    ).arrayBuffer();
    await expect(
      withUpstreamResponse('http://localhost/api/detail', loader, options),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('holds shared host slots until the response body ends or is canceled', async () => {
    process.env.UPSTREAM_METADATA_HOST_CONCURRENCY = '2';
    const first = await withUpstreamResponse('https://up.example/a', loader, {
      store,
    });
    const second = await withUpstreamResponse(
      'https://up.example:8443/b',
      loader,
      { store },
    );
    const blocked = jest.fn(loader);
    await expect(
      withUpstreamResponse('https://up.example/c', blocked, { store }),
    ).rejects.toMatchObject({ status: 503 });
    expect(blocked).not.toHaveBeenCalled();
    const other = await withUpstreamResponse(
      'https://other.example/a',
      loader,
      { store },
    );
    await other.body!.cancel();
    await first.arrayBuffer();
    const replacement = await withUpstreamResponse(
      'https://up.example/c',
      loader,
      { store },
    );
    await replacement.body!.cancel();
    await second.body!.cancel();
  });

  it('bounds global connections across distinct hosts and shares VOD/live user slots', async () => {
    process.env.UPSTREAM_MEDIA_CONCURRENCY = '2';
    process.env.UPSTREAM_MEDIA_USER_CONCURRENCY = '1';
    const first = await withUpstreamResponse('https://one.example/a', loader, {
      store,
      kind: 'vod',
      identity: 'user:one',
    });
    await expect(
      withUpstreamResponse('https://two.example/b', loader, {
        store,
        kind: 'live',
        identity: 'user:one',
      }),
    ).rejects.toMatchObject({ status: 429 });
    const second = await withUpstreamResponse('https://two.example/b', loader, {
      store,
      kind: 'live',
      identity: 'user:two',
    });
    await expect(
      withUpstreamResponse('https://three.example/c', loader, {
        store,
        kind: 'vod',
        identity: 'user:three',
      }),
    ).rejects.toMatchObject({ status: 503 });
    await first.body!.cancel();
    await second.body!.cancel();
  });

  it('limits host rate after completed requests and returns Retry-After', async () => {
    process.env.UPSTREAM_METADATA_HOST_RPM = '1';
    await (
      await withUpstreamResponse('https://one.example/a', loader, { store })
    ).arrayBuffer();
    const error = await withUpstreamResponse('https://one.example/b', loader, {
      store,
    }).catch((failure) => failure);
    expect(error).toBeInstanceOf(ResourceLimitError);
    expect(resourceLimitResponse(error)?.status).toBe(503);
    expect(
      Number(resourceLimitResponse(error)?.headers.get('Retry-After')),
    ).toBeGreaterThan(0);
  });

  it('cancels upstream on byte exhaustion and does not open a new connection without credit', async () => {
    process.env.UPSTREAM_MEDIA_USER_MIB_PER_MINUTE = '1';
    const options = { store, kind: 'vod' as const, identity: 'user:one' };
    const cancel = jest.fn();
    const response = await withUpstreamResponse(
      'https://up.example/a',
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(600 * 1024));
            },
            cancel,
          }),
        ),
      options,
    );
    await expect(response.arrayBuffer()).rejects.toMatchObject({ status: 429 });
    expect(cancel).toHaveBeenCalled();
    // 本实例已预约未用完的余额仍可用：连同被拒前送出的 600 KiB 恰好用满 1 MiB
    const remainder = await withUpstreamResponse(
      'https://up.example/remainder',
      () => Promise.resolve(new Response(new Uint8Array(424 * 1024))),
      options,
    );
    expect((await remainder.arrayBuffer()).byteLength).toBe(424 * 1024);
    // 本地余额与数据库额度都用尽后，准入即被拒，不建立上游连接
    const nextLoader = jest.fn(loader);
    await expect(
      withUpstreamResponse('https://up.example/b', nextLoader, options),
    ).rejects.toMatchObject({ status: 429 });
    expect(nextLoader).not.toHaveBeenCalled();
  });

  it('reserves request and byte quotas in blocks instead of every 256 KiB', async () => {
    const consume = jest.spyOn(store, 'consume');
    const options = { store, kind: 'vod' as const, identity: 'user:one' };
    const segment = async () => {
      let sent = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent === 2 * 1024 * 1024) return controller.close();
            controller.enqueue(new Uint8Array(64 * 1024));
            sent += 64 * 1024;
          },
        }),
      );
    };
    const first = await withUpstreamResponse(
      'https://up.example/1.ts',
      segment,
      options,
    );
    expect((await first.arrayBuffer()).byteLength).toBe(2 * 1024 * 1024);
    // 2 个请求数键与 3 个流量键各预约一块；逐 256 KiB 预约需要 2 + 8 × 3 = 26 次
    expect(consume).toHaveBeenCalledTimes(5);
    consume.mockClear();
    const second = await withUpstreamResponse(
      'https://up.example/2.ts',
      segment,
      options,
    );
    expect((await second.arrayBuffer()).byteLength).toBe(2 * 1024 * 1024);
    // 全局与主机的 8 MiB 块仍有余额，只有 3 MiB 的单用户块需要补一次
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it('releases partial admissions and fails closed on database errors', async () => {
    process.env.UPSTREAM_METADATA_CONCURRENCY = '1';
    jest
      .spyOn(store, 'consume')
      .mockRejectedValueOnce(new Error('database down'));
    const origin = jest.fn(loader);
    await expect(
      withUpstreamResponse('https://up.example/a', origin, { store }),
    ).rejects.toMatchObject({ status: 503 });
    expect(origin).not.toHaveBeenCalled();
    await (
      await withUpstreamResponse('https://up.example/a', loader, { store })
    ).body!.cancel();
    jest
      .spyOn(db, 'getSharedResourceStore')
      .mockRejectedValue(new Error('database down'));
    await expect(
      withUpstreamResponse('https://up.example/a', origin),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('releases after origin rejection and a stream read error', async () => {
    process.env.UPSTREAM_METADATA_HOST_CONCURRENCY = '1';
    const failure = new Error('origin failed');
    await expect(
      withUpstreamResponse(
        'https://up.example/a',
        async () => {
          throw failure;
        },
        { store },
      ),
    ).rejects.toBe(failure);
    const response = await withUpstreamResponse(
      'https://up.example/b',
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(failure);
            },
          }),
        ),
      { store },
    );
    await expect(response.text()).rejects.toBe(failure);
    await (
      await withUpstreamResponse('https://up.example/c', loader, { store })
    ).body!.cancel();
  });

  it('cancels when the client disconnects and releases shared slots', async () => {
    process.env.UPSTREAM_METADATA_HOST_CONCURRENCY = '1';
    const parent = new AbortController();
    const cancel = jest.fn();
    const response = await withUpstreamResponse(
      'https://up.example/a',
      async () => new Response(new ReadableStream({ cancel })),
      { store, signal: parent.signal },
    );
    const body = response.text();
    parent.abort(new Error('disconnected'));
    await expect(body).rejects.toThrow('disconnected');
    expect(cancel).toHaveBeenCalled();
    await (
      await withUpstreamResponse('https://up.example/b', loader, { store })
    ).body!.cancel();
  });

  it('releases leases once when aborted before the origin responds', async () => {
    const release = jest.spyOn(store, 'release');
    const parent = new AbortController();
    let started!: () => void;
    const originStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let respond!: (response: Response) => void;
    // 上游不理会中止信号，读取器迟迟不能创建
    const pending = withUpstreamResponse(
      'https://up.example/a',
      () => {
        started();
        return new Promise<Response>((resolve) => {
          respond = resolve;
        });
      },
      { store, signal: parent.signal },
    );
    await originStarted;
    expect(leaseCount()).toBe(2);
    parent.abort(new Error('disconnected'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(leaseCount()).toBe(0);
    expect(release).toHaveBeenCalledTimes(2);
    const cancel = jest.fn();
    respond(new Response(new ReadableStream({ cancel })));
    await expect(pending).rejects.toThrow('disconnected');
    expect(cancel).toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('still releases leases acquired after an abort during admission', async () => {
    const parent = new AbortController();
    const acquire = store.acquire.bind(store);
    let admitHost!: () => void;
    const hostTurn = new Promise<void>((resolve) => {
      admitHost = resolve;
    });
    jest.spyOn(store, 'acquire').mockImplementation(async (key, ...rest) => {
      if (key.startsWith('connections:metadata:host:')) await hostTurn;
      return acquire(key, ...rest);
    });
    const origin = jest.fn(loader);
    const pending = withUpstreamResponse('https://up.example/a', origin, {
      store,
      signal: parent.signal,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(leaseCount()).toBe(1);
    parent.abort(new Error('disconnected'));
    admitHost();
    await expect(pending).rejects.toThrow('disconnected');
    expect(origin).not.toHaveBeenCalled();
    expect(leaseCount()).toBe(0);
  });

  it('renews long responses and aborts if ownership is lost', async () => {
    jest.useFakeTimers('modern');
    const renew = jest.spyOn(store, 'renew');
    const response = await withUpstreamResponse(
      'https://up.example/a',
      async () => new Response(new ReadableStream()),
      { store },
    );
    jest.advanceTimersByTime(10_000);
    for (let step = 0; step < 12; step += 1) await Promise.resolve();
    expect(renew).toHaveBeenCalledTimes(2);
    renew.mockResolvedValue(false);
    const body = response.text();
    jest.advanceTimersByTime(10_000);
    await expect(body).rejects.toMatchObject({ status: 503 });
  });
});
