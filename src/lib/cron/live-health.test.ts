/** @jest-environment node */
import { getCachedLiveChannels } from '@/features/live/lib/live';
import { LIVE_HEALTH_POLICY as POLICY } from '@/features/live/lib/liveHealthPolicy';
import { probeLiveLine } from '@/features/live/lib/liveHealthProbe.server';
import {
  readLiveHealthSnapshot,
  writeLiveHealthSnapshot,
} from '@/features/live/lib/liveHealthSnapshot.server';
import type { LiveChannel } from '@/features/live/types';
import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import { isServerRelayPaused } from '@/lib/host-traffic.server';

import { probeConfiguredLiveLines } from './live-health';

jest.mock('@/features/live/lib/live', () => ({
  getCachedLiveChannels: jest.fn(),
  isLiveEntryEnabledInConfig: (config: {
    SiteConfig: { EnableLiveEntry: boolean };
  }) => config.SiteConfig.EnableLiveEntry,
}));
jest.mock('@/features/live/lib/liveHealthProbe.server', () => ({
  ...jest.requireActual('@/features/live/lib/liveHealthProbe.server'),
  probeLiveLine: jest.fn(),
}));
jest.mock('@/features/live/lib/liveHealthSnapshot.server', () => ({
  ...jest.requireActual('@/features/live/lib/liveHealthSnapshot.server'),
  readLiveHealthSnapshot: jest.fn(),
  writeLiveHealthSnapshot: jest.fn(),
}));
jest.mock('@/lib/config', () => ({ getConfigForRead: jest.fn() }));
jest.mock('@/lib/db', () => ({
  db: {
    acquireSharedCacheLease: jest.fn(),
    renewSharedCacheLease: jest.fn(),
    releaseSharedCacheLease: jest.fn(),
  },
}));
jest.mock('@/lib/host-traffic.server', () => ({
  isServerRelayPaused: jest.fn(),
}));

const channel = (id: string): LiveChannel => ({
  id,
  lineId: id,
  name: id,
  url: `https://${id}.example/index.m3u8`,
  tvgId: '',
  group: '',
  logo: '',
});
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(db.acquireSharedCacheLease).mockResolvedValue(true);
  jest.mocked(db.renewSharedCacheLease).mockResolvedValue(true);
  (getConfigForRead as jest.Mock).mockResolvedValue({
    SiteConfig: { EnableLiveEntry: true },
    LiveConfig: [{ key: 's', url: 'https://list.example', ua: 'ua' }],
  });
  (getCachedLiveChannels as jest.Mock).mockResolvedValue({
    channels: [channel('old'), channel('new'), channel('fresh')],
  });
  jest.mocked(readLiveHealthSnapshot).mockResolvedValue({
    lines: {
      old: { status: 'ok', checkedAt: Date.now() - POLICY.refreshMs },
      fresh: { status: 'ok', checkedAt: Date.now() },
      removed: { status: 'failed', checkedAt: Date.now() },
    },
  });
  jest
    .mocked(probeLiveLine)
    .mockResolvedValue({ status: 'slow', checkedAt: Date.now() });
});

it('prioritizes unchecked lines, skips fresh lines, prunes and persists progress', async () => {
  const saved: unknown[] = [];
  jest
    .mocked(writeLiveHealthSnapshot)
    .mockImplementation(async (_, snapshot) => {
      saved.push(JSON.parse(JSON.stringify(snapshot)));
    });
  await probeConfiguredLiveLines();
  expect(jest.mocked(probeLiveLine).mock.calls.map(([url]) => url)).toEqual([
    channel('new').url,
    channel('old').url,
  ]);
  expect(saved[0]).toEqual({
    lines: { old: expect.any(Object), fresh: expect.any(Object) },
  });
  expect(saved.at(-1)).toEqual({
    lines: {
      old: expect.objectContaining({ status: 'slow' }),
      new: expect.objectContaining({ status: 'slow' }),
      fresh: expect.objectContaining({ status: 'ok' }),
    },
  });
  expect(db.releaseSharedCacheLease).toHaveBeenCalledWith(
    'live-health:run:v1',
    expect.any(String),
  );
});

it('keeps old results when a probe is deferred', async () => {
  jest.mocked(probeLiveLine).mockResolvedValue(null);
  await probeConfiguredLiveLines();
  expect(writeLiveHealthSnapshot).toHaveBeenCalledTimes(1);
  expect(
    jest.mocked(writeLiveHealthSnapshot).mock.calls[0][1].lines.old.status,
  ).toBe('ok');
});

it('does not probe when another instance holds the lease or relay is paused', async () => {
  jest.mocked(db.acquireSharedCacheLease).mockResolvedValueOnce(false);
  await probeConfiguredLiveLines();
  expect(getCachedLiveChannels).not.toHaveBeenCalled();
  jest.mocked(isServerRelayPaused).mockResolvedValue(true);
  await probeConfiguredLiveLines();
  expect(probeLiveLine).not.toHaveBeenCalled();
});

it('runs at most two concurrent probes', async () => {
  (getCachedLiveChannels as jest.Mock).mockResolvedValue({
    channels: ['a', 'b', 'c', 'd'].map(channel),
  });
  jest.mocked(readLiveHealthSnapshot).mockResolvedValue({ lines: {} });
  let active = 0;
  let peak = 0;
  jest.mocked(probeLiveLine).mockImplementation(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    active--;
    return { status: 'ok', checkedAt: Date.now() };
  });
  await probeConfiguredLiveLines();
  expect(peak).toBe(POLICY.concurrency);
});

it('stops writing after lease loss', async () => {
  jest.mocked(readLiveHealthSnapshot).mockResolvedValue({ lines: {} });
  jest.mocked(db.renewSharedCacheLease).mockResolvedValue(false);
  await expect(probeConfiguredLiveLines()).rejects.toThrow('lease lost');
  expect(writeLiveHealthSnapshot).not.toHaveBeenCalled();
});
