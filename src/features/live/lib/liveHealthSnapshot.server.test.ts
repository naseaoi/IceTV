/** @jest-environment node */
import type { LiveChannel } from '@/features/live/types';
import { db } from '@/lib/db';

import { LIVE_HEALTH_POLICY as POLICY } from './liveHealthPolicy';
import {
  attachLiveHealth,
  displayLiveHealth,
  isLiveHealthDue,
  pruneLiveHealthSnapshot,
  readLiveHealthSnapshot,
  writeLiveHealthSnapshot,
} from './liveHealthSnapshot.server';

jest.mock('@/lib/db', () => ({
  db: {
    getSharedCache: jest.fn(),
    acquireSharedCacheLease: jest.fn(),
    setSharedCache: jest.fn(),
    releaseSharedCacheLease: jest.fn(),
  },
}));
const channel: LiveChannel = {
  id: 's-0',
  lineId: 'line',
  name: 'name',
  tvgId: '',
  logo: '',
  group: '',
  url: 'https://live.example/a',
};
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(db.acquireSharedCacheLease).mockResolvedValue(true);
  jest.mocked(db.setSharedCache).mockResolvedValue(true);
});

it('selects only unchecked or three-hour-old results', () => {
  const now = Date.now();
  expect(isLiveHealthDue(undefined, now)).toBe(true);
  expect(
    isLiveHealthDue(
      { status: 'failed', checkedAt: now - POLICY.refreshMs },
      now,
    ),
  ).toBe(true);
  expect(
    isLiveHealthDue(
      { status: 'ok', checkedAt: now - POLICY.refreshMs + 1 },
      now,
    ),
  ).toBe(false);
});

it('degrades twelve-hour-old results while retaining checkedAt', () => {
  const now = Date.now();
  const old = {
    status: 'ok' as const,
    checkedAt: now - POLICY.unknownAfterMs,
    latencyMs: 100,
  };
  expect(displayLiveHealth(old, now)).toEqual({
    status: 'unknown',
    checkedAt: old.checkedAt,
  });
  expect(
    displayLiveHealth({ ...old, checkedAt: old.checkedAt + 1 }, now).status,
  ).toBe('ok');
});

it('prunes removed line fingerprints and attaches only current line health', async () => {
  const health = { status: 'slow' as const, checkedAt: Date.now() };
  const snapshot = { lines: { line: health, old: health } };
  expect(pruneLiveHealthSnapshot(snapshot, [channel])).toEqual({
    lines: { line: health },
  });
  jest.mocked(db.getSharedCache).mockResolvedValue({
    value: JSON.stringify(snapshot),
    freshUntil: Date.now(),
    staleUntil: Date.now() + 1000,
    leaseUntil: 0,
  });
  expect(await attachLiveHealth('s', [channel])).toEqual([
    { ...channel, health },
  ]);
  expect(db.acquireSharedCacheLease).not.toHaveBeenCalled();
});

it('ignores expired storage rows', async () => {
  jest.mocked(db.getSharedCache).mockResolvedValue({
    value: '{}',
    freshUntil: 1,
    staleUntil: 2,
    leaseUntil: 0,
  });
  expect(await readLiveHealthSnapshot('s')).toEqual({ lines: {} });
});

it('writes with a token and releases failed writes, preserving placeholder cleanup', async () => {
  await writeLiveHealthSnapshot('s', { lines: {} });
  expect(db.setSharedCache).toHaveBeenCalledWith(
    'live-health:v1:s',
    expect.any(String),
    '{"lines":{}}',
    expect.any(Number),
    expect.any(Number),
    expect.any(Number),
  );
  expect(db.releaseSharedCacheLease).not.toHaveBeenCalled();
  jest.mocked(db.setSharedCache).mockResolvedValue(false);
  await expect(writeLiveHealthSnapshot('s', { lines: {} })).rejects.toThrow(
    'lease lost',
  );
  expect(db.releaseSharedCacheLease).toHaveBeenCalledWith(
    'live-health:v1:s',
    expect.any(String),
  );
});
