/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '../../test-utils/web-polyfills';

installWebPolyfills();

type Plan = { delayMs: number; playable: boolean };
const plans: Record<string, Plan> = {};
let healthTiers = new Map<string, string>();
let proxyModes: Record<string, string | undefined> = {};

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(async () => ({ username: 'alice' })),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: jest.fn(async () => ({
    SiteConfig: { DisableYellowFilter: true },
    SourceConfig: Object.keys(plans).map((key) => ({
      key,
      proxyMode: proxyModes[key],
    })),
  })),
  getAvailableApiSites: jest.fn(async () =>
    Object.keys(plans).map((key) => ({ key, name: key, api: key })),
  ),
}));
jest.mock('@/lib/source-health.server', () => ({
  getSourceHealthTiers: jest.fn(async () => healthTiers),
}));
jest.mock('@/lib/source-match', () => ({
  filterSourcesForPlayback: (results: unknown[]) => results,
}));
jest.mock('@/lib/yellow', () => ({ yellowWords: [] }));
jest.mock('@/lib/downstream', () => ({
  searchFirstPageFromApi: jest.fn(async (site: { key: string }) => [
    { source: site.key, id: '1', title: 'Show', episodes: [] },
  ]),
}));
jest.mock('@/lib/detail-cache', () => ({
  getCachedDetail: jest.fn(async (site: { key: string }) => {
    const plan = plans[site.key];
    await new Promise((resolve) => setTimeout(resolve, plan.delayMs));
    return { episodes: plan.playable ? ['ep1.m3u8'] : [] };
  }),
}));

const { GET } = require('./route') as typeof import('./route');

async function quickWinner(): Promise<{ source: string; ms: number }> {
  const started = Date.now();
  const response = await GET({
    url: 'http://localhost/api/search/quick?q=Show',
  } as NextRequest);
  const body = (await response.json()) as { detail: { source: string } };
  return { source: body.detail.source, ms: Date.now() - started };
}

function setPlans(next: Record<string, Plan>) {
  for (const key of Object.keys(plans)) delete plans[key];
  Object.assign(plans, next);
}

describe('quick search route preference', () => {
  beforeEach(() => {
    healthTiers = new Map();
    proxyModes = {};
  });

  it('waits briefly for a direct source of the same health tier', async () => {
    setPlans({
      relay: { delayMs: 5, playable: true },
      direct: { delayMs: 200, playable: true },
    });
    proxyModes = { relay: 'server' };

    await expect(quickWinner()).resolves.toMatchObject({ source: 'direct' });
  });

  it('treats auto sources as direct candidates', async () => {
    setPlans({
      blocked: { delayMs: 5, playable: true },
      direct: { delayMs: 200, playable: true },
    });
    proxyModes = { blocked: 'auto' };

    await expect(quickWinner()).resolves.toMatchObject({ source: 'blocked' });
  });

  it('returns the relay source once no direct peer can win', async () => {
    setPlans({
      relay: { delayMs: 5, playable: true },
      direct: { delayMs: 50, playable: false },
    });
    proxyModes = { relay: 'server' };

    const winner = await quickWinner();
    expect(winner.source).toBe('relay');
    expect(winner.ms).toBeLessThan(1_000);
  });

  it('does not wait for direct sources with worse health', async () => {
    setPlans({
      relay: { delayMs: 5, playable: true },
      direct: { delayMs: 300, playable: true },
    });
    proxyModes = { relay: 'server' };
    healthTiers = new Map([
      ['relay', 'good'],
      ['direct', 'poor'],
    ]);

    const winner = await quickWinner();
    expect(winner.source).toBe('relay');
    expect(winner.ms).toBeLessThan(250);
  });

  it('falls back to the relay source after the grace window', async () => {
    setPlans({
      relay: { delayMs: 5, playable: true },
      direct: { delayMs: 1_900, playable: true },
    });
    proxyModes = { relay: 'server' };

    const winner = await quickWinner();
    expect(winner.source).toBe('relay');
    expect(winner.ms).toBeLessThan(1_850);
  });
});
