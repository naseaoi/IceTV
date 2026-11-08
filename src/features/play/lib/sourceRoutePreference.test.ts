import type { SourcePlaybackStat } from '@/lib/source-playback-stats';

import {
  type SourceSelectionContext,
  compareSourceRoutePreference,
  preferDirectRouteSources,
} from './sourceRoutePreference';

const now = Date.now();
const source = (key: string) => ({ source: key });
const context: SourceSelectionContext = {
  proxyModes: {
    relay: 'server',
    browser: 'browser',
    auto: 'auto',
    poor: 'browser',
  },
  healthTiers: {
    relay: 'good',
    browser: 'good',
    auto: 'good',
    missing: 'good',
    poor: 'poor',
  },
};
const stats = new Map<string, SourcePlaybackStat>();

describe('client route preference', () => {
  it('prefers all non-server modes within a health tier without mutating input', () => {
    const input = ['relay', 'auto', 'missing', 'poor', 'browser'].map(source);
    expect(
      preferDirectRouteSources(input, context, stats).map((s) => s.source),
    ).toEqual(['auto', 'missing', 'browser', 'relay', 'poor']);
    expect(input[0].source).toBe('relay');
  });

  it('keeps original order when modes or health tiers are unavailable', () => {
    const input = ['poor', 'relay', 'browser'].map(source);
    expect(
      preferDirectRouteSources(input, { ...context, proxyModes: {} }, stats),
    ).toEqual(input);
    expect(
      preferDirectRouteSources(input, { ...context, healthTiers: {} }, stats),
    ).toEqual(input);
  });

  it('keeps local reliability tiers ahead of route preference', () => {
    const trusted = {
      startupMs: 100,
      successes: 5,
      failures: 0,
      manualSelections: 0,
      lastUsedAt: now,
    };
    const history = new Map([['relay', trusted]]);
    expect(
      compareSourceRoutePreference(
        source('relay'),
        source('browser'),
        context,
        history,
        now,
      ),
    ).toBeLessThan(0);
    history.set('browser', { ...trusted, startupMs: 5000 });
    expect(
      compareSourceRoutePreference(
        source('relay'),
        source('browser'),
        context,
        history,
        now,
      ),
    ).toBeGreaterThan(0);
  });

  it('does not promote a worse health tier even with trusted history', () => {
    const history = new Map([
      [
        'poor',
        {
          startupMs: 100,
          successes: 5,
          failures: 0,
          manualSelections: 0,
          lastUsedAt: now,
        },
      ],
    ]);
    expect(
      preferDirectRouteSources(
        ['poor', 'relay'].map(source),
        context,
        history,
        now,
      ).map((s) => s.source),
    ).toEqual(['relay', 'poor']);
  });
});
