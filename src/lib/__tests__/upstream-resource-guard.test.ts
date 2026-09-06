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
import { withUpstreamResponse } from '@/lib/upstream-resource-guard.server';

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
      if (key.startsWith('UPSTREAM_')) delete process.env[key];
    for (const [key, value] of Object.entries(initialEnv))
      if (key.startsWith('UPSTREAM_')) process.env[key] = value;
    (storage as unknown as { db: Database.Database }).db.close();
  });

  const loader = () => Promise.resolve(new Response(new Uint8Array(16)));

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
      { store, kind: 'vod', identity: 'user:one' },
    );
    await expect(response.arrayBuffer()).rejects.toMatchObject({ status: 429 });
    expect(cancel).toHaveBeenCalled();
    await (
      await withUpstreamResponse('https://up.example/remainder', loader, {
        store,
        kind: 'vod',
        identity: 'user:one',
      })
    ).arrayBuffer();
    const nextLoader = jest.fn(loader);
    await expect(
      withUpstreamResponse('https://up.example/b', nextLoader, {
        store,
        kind: 'vod',
        identity: 'user:one',
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect(nextLoader).not.toHaveBeenCalled();
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
