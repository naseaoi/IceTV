/** @jest-environment node */

import { promises as fs } from 'fs';

import { getConfigForRead } from '@/lib/config';
import {
  getHostTrafficStatus,
  isServerRelayPaused,
  resetHostTrafficCache,
} from '@/lib/host-traffic.server';
import type { AdminConfig } from '@/types/admin';

jest.mock('fs', () => ({ promises: { open: jest.fn() } }));
jest.mock('@/lib/config', () => ({ getConfigForRead: jest.fn() }));

const NOW = Date.parse('2026-11-11T00:00:00Z');
const config = { TrafficConfig: { QuotaGB: 1, ResetDay: 1 } } as AdminConfig;

function fileHandle(bytes: number) {
  const content = Buffer.from(
    JSON.stringify({
      interfaces: [
        {
          updated: { timestamp: NOW / 1000 },
          traffic: {
            day: [
              { date: { year: 2026, month: 11, day: 11 }, rx: bytes, tx: 0 },
            ],
          },
        },
      ],
    }),
  );
  return {
    stat: jest.fn(async () => ({
      isFile: () => true,
      size: content.length,
      mtimeMs: NOW,
    })),
    read: jest.fn(async (buffer: Buffer) => ({
      bytesRead: content.copy(buffer),
    })),
    close: jest.fn(async () => undefined),
  } as unknown as fs.FileHandle;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('host traffic snapshot coalescing', () => {
  beforeEach(() => {
    resetHostTrafficCache();
    jest.mocked(fs.open).mockReset();
    jest.mocked(getConfigForRead).mockReset().mockResolvedValue(config);
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shares cold reads, keeps the 30-second TTL and merges refreshes', async () => {
    const first = fileHandle(960_000_000);
    jest.mocked(fs.open).mockResolvedValue(first);
    const statuses = await Promise.all(
      Array.from({ length: 10 }, () => getHostTrafficStatus(config, NOW)),
    );
    expect(statuses.every((status) => status.relay === 'paused')).toBe(true);
    expect(fs.open).toHaveBeenCalledTimes(1);
    expect(first.read).toHaveBeenCalledTimes(1);
    expect(first.close).toHaveBeenCalledTimes(1);
    await getHostTrafficStatus(config, NOW + 29_999);
    expect(fs.open).toHaveBeenCalledTimes(1);
    jest.mocked(fs.open).mockResolvedValue(fileHandle(1));
    const refreshed = await Promise.all(
      Array.from({ length: 10 }, () =>
        getHostTrafficStatus(config, NOW + 30_000),
      ),
    );
    expect(refreshed.every((status) => status.relay === 'active')).toBe(true);
    expect(fs.open).toHaveBeenCalledTimes(2);
    expect(getConfigForRead).not.toHaveBeenCalled();
  });

  it.each(['old-first', 'new-first'])(
    'prevents invalidated work from overwriting or clearing new work (%s)',
    async (order) => {
      const old = deferred<fs.FileHandle>();
      const current = deferred<fs.FileHandle>();
      jest
        .mocked(fs.open)
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise);
      const first = getHostTrafficStatus(config, NOW);
      resetHostTrafficCache();
      const second = getHostTrafficStatus(config, NOW);
      if (order === 'old-first') {
        old.resolve(fileHandle(960_000_000));
        await first;
        const third = getHostTrafficStatus(config, NOW);
        expect(fs.open).toHaveBeenCalledTimes(2);
        current.resolve(fileHandle(1));
        await Promise.all([second, third]);
      } else {
        current.resolve(fileHandle(1));
        await second;
        old.resolve(fileHandle(960_000_000));
        await first;
      }
      expect((await getHostTrafficStatus(config, NOW)).usedBytes).toBe(1);
      expect(fs.open).toHaveBeenCalledTimes(2);
    },
  );

  it('shares failures, keeps fail-open behavior and retries after the existing TTL', async () => {
    jest
      .mocked(fs.open)
      .mockRejectedValue(
        Object.assign(new Error('missing'), { code: 'ENOENT' }),
      );
    expect(
      await Promise.all([
        isServerRelayPaused(config),
        isServerRelayPaused(config),
      ]),
    ).toEqual([false, false]);
    expect(fs.open).toHaveBeenCalledTimes(1);
    expect(await isServerRelayPaused(config)).toBe(false);
    expect(fs.open).toHaveBeenCalledTimes(1);
    jest.mocked(fs.open).mockResolvedValue(fileHandle(960_000_000));
    expect((await getHostTrafficStatus(config, NOW + 30_000)).relay).toBe(
      'paused',
    );
    expect(fs.open).toHaveBeenCalledTimes(2);
  });

  it('uses supplied settings without another config read and retains config failure fallback', async () => {
    jest.mocked(fs.open).mockResolvedValue(fileHandle(960_000_000));
    expect(await isServerRelayPaused(config)).toBe(true);
    expect(getConfigForRead).not.toHaveBeenCalled();
    jest
      .mocked(getConfigForRead)
      .mockRejectedValue(new Error('config unavailable'));
    expect(await isServerRelayPaused()).toBe(false);
  });
});
