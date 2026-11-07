import { getProxyModes } from '@/lib/proxy-modes';

import {
  getSourceSelectionContext,
  peekSourceSelectionContext,
  resetSourceSelectionContextForTests,
} from './sourceSelectionContext';

jest.mock('@/lib/proxy-modes', () => ({ getProxyModes: jest.fn() }));
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
beforeEach(() => {
  resetSourceSelectionContextForTests();
  (getProxyModes as jest.Mock).mockResolvedValue({ relay: 'server' });
});

function mockTiers(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

it('deduplicates inflight reads and validates external tier values', async () => {
  mockTiers({ relay: 'good', bad: 'constructor', invalid: 1 });
  const [a, b] = await Promise.all([
    getSourceSelectionContext(),
    getSourceSelectionContext(),
  ]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(a).toEqual({
    proxyModes: { relay: 'server' },
    healthTiers: { relay: 'good' },
  });
  expect(b).toEqual(a);
});

it('falls back to empty tiers on network failure', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  expect(await getSourceSelectionContext()).toEqual({
    proxyModes: { relay: 'server' },
    healthTiers: {},
  });
});

it('reuses the cached context without another request', async () => {
  mockTiers({ relay: 'good' });
  await getSourceSelectionContext();
  await getSourceSelectionContext();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('peeks synchronously: empty before the first load, cached afterwards', async () => {
  mockTiers({ relay: 'good' });
  expect(peekSourceSelectionContext()).toEqual({
    proxyModes: {},
    healthTiers: {},
  });
  await getSourceSelectionContext();
  expect(peekSourceSelectionContext()).toEqual({
    proxyModes: { relay: 'server' },
    healthTiers: { relay: 'good' },
  });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
