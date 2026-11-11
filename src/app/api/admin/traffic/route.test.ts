/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { requireOwner } from '@/lib/api-auth';
import {
  getConfig,
  getConfigFresh,
  invalidateConfigCache,
  saveConfig,
} from '@/lib/config';
import { getHostTrafficStatus } from '@/lib/host-traffic.server';

jest.mock('@/lib/api-auth', () => ({
  requireOwner: jest.fn(),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/config', () => ({
  ConfigConflictError: class ConfigConflictError extends Error {},
  getConfig: jest.fn(),
  getConfigFresh: jest.fn(),
  invalidateConfigCache: jest.fn(),
  saveConfig: jest.fn(),
}));
jest.mock('@/lib/host-traffic.server', () => ({
  getHostTrafficStatus: jest.fn(),
  resetHostTrafficCache: jest.fn(),
}));
installWebPolyfills();
const { PATCH, POST } = require('./route') as typeof import('./route');

function jsonRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

let stored: Record<string, any>;

beforeEach(() => {
  jest.clearAllMocks();
  stored = { TrafficConfig: { QuotaGB: 6000, ResetDay: 1 } };
  (requireOwner as jest.Mock).mockResolvedValue({ username: 'owner' });
  (getConfig as jest.Mock).mockImplementation(async () => stored);
  (getConfigFresh as jest.Mock).mockImplementation(async () => stored);
  (saveConfig as jest.Mock).mockResolvedValue(undefined);
  (getHostTrafficStatus as jest.Mock).mockResolvedValue({
    cycleStart: '2026-11-01',
  });
});

it('rejects out-of-range settings without writing config', async () => {
  for (const body of [
    { QuotaGB: -1, ResetDay: 1 },
    { QuotaGB: 1.5, ResetDay: 1 },
    { QuotaGB: 100, ResetDay: 29 },
    null,
  ]) {
    const response = await PATCH(jsonRequest(body));
    expect(response.status).toBe(400);
  }
  expect(saveConfig).not.toHaveBeenCalled();
});

it('saves settings on a fresh writable config and keeps the manual resume', async () => {
  stored.TrafficConfig.RelayResumedCycle = '2026-11-01';
  const response = await PATCH(jsonRequest({ QuotaGB: 5000, ResetDay: 5 }));
  expect(response.status).toBe(200);
  expect(invalidateConfigCache).toHaveBeenCalled();
  expect(saveConfig).toHaveBeenCalledWith(
    expect.objectContaining({
      TrafficConfig: {
        QuotaGB: 5000,
        ResetDay: 5,
        RelayResumedCycle: '2026-11-01',
      },
    }),
  );
  await expect(response.json()).resolves.toMatchObject({
    settings: { QuotaGB: 5000, ResetDay: 5 },
  });
});

it('resumes relay for the current cycle and can restore automatic pausing', async () => {
  await POST(jsonRequest({ relay: 'resume' }));
  expect(stored.TrafficConfig.RelayResumedCycle).toBe('2026-11-01');

  await POST(jsonRequest({ relay: 'auto' }));
  expect(stored.TrafficConfig).toEqual({ QuotaGB: 6000, ResetDay: 1 });

  const invalid = await POST(jsonRequest({ relay: 'pause' }));
  expect(invalid.status).toBe(400);
});

it('is restricted to the owner', async () => {
  const denied = new Response(null, { status: 403 });
  (requireOwner as jest.Mock).mockResolvedValue({ response: denied });
  expect(await POST(jsonRequest({ relay: 'resume' }))).toBe(denied);
  expect(saveConfig).not.toHaveBeenCalled();
});
