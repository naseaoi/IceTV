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

  it('promotes locally reliable sources above globally healthy but locally failing sources', () => {
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
      [
        'relay',
        {
          startupMs: null,
          successes: 0,
          failures: 2,
          manualSelections: 0,
          lastUsedAt: now,
        },
      ],
    ]);
    expect(
      preferDirectRouteSources(
        ['relay', 'poor'].map(source),
        context,
        history,
        now,
      ).map((s) => s.source),
    ).toEqual(['poor', 'relay']);
  });

  it.each([
    { proxyModes: {}, healthTiers: context.healthTiers },
    { proxyModes: context.proxyModes, healthTiers: {} },
    { proxyModes: {}, healthTiers: {} },
  ])(
    'uses local evidence even with incomplete context: %j',
    (partialContext) => {
      const history = new Map([
        [
          'poor',
          {
            startupMs: 100,
            successes: 3,
            failures: 0,
            manualSelections: 0,
            lastUsedAt: now,
          },
        ],
      ]);
      expect(
        compareSourceRoutePreference(
          source('poor'),
          source('relay'),
          partialContext,
          history,
          now,
        ),
      ).toBeLessThan(0);
    },
  );

  it.each([
    { successes: 1, failures: 0, idleDays: 0 },
    { successes: 0, failures: 1, idleDays: 0 },
    { successes: 5, failures: 0, idleDays: 15 },
    { successes: 0, failures: 2, idleDays: 15 },
  ])(
    'falls back to global health for tiny or decayed neutral samples: %j',
    ({ successes, failures, idleDays }) => {
      const history = new Map([
        [
          'poor',
          {
            startupMs: 100,
            successes,
            failures,
            manualSelections: 0,
            lastUsedAt: now - idleDays * 24 * 60 * 60 * 1000,
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
    },
  );

  it.each([
    { successes: 3, failures: 0 },
    { successes: 0, failures: 2 },
  ])(
    'uses the route rather than global health within an evidence tier: %j',
    (samples) => {
      const stat = {
        startupMs: 100,
        ...samples,
        manualSelections: 0,
        lastUsedAt: now,
      };
      const history = new Map([
        ['poor', stat],
        ['relay', stat],
      ]);
      expect(
        compareSourceRoutePreference(
          source('poor'),
          source('relay'),
          context,
          history,
          now,
        ),
      ).toBeLessThan(0);
      expect(
        compareSourceRoutePreference(
          source('poor'),
          source('relay'),
          { ...context, proxyModes: {} },
          history,
          now,
        ),
      ).toBe(0);
    },
  );
});

it('uses personal duration only as the final neutral, same-health and same-route tie breaker', () => {
  const personal = {
    ...context,
    watchSeconds: { browser: 20, auto: 100, poor: 9999, relay: 99999 },
  };
  expect(
    preferDirectRouteSources(
      ['browser', 'auto', 'relay', 'poor'].map(source),
      personal,
      stats,
    ).map((item) => item.source),
  ).toEqual(['auto', 'browser', 'relay', 'poor']);
  const trusted = {
    startupMs: 100,
    successes: 5,
    failures: 0,
    manualSelections: 0,
    lastUsedAt: now,
  };
  expect(
    compareSourceRoutePreference(
      source('browser'),
      source('auto'),
      personal,
      new Map([
        ['browser', trusted],
        ['auto', trusted],
      ]),
      now,
    ),
  ).toBe(0);
  expect(
    compareSourceRoutePreference(
      source('browser'),
      source('auto'),
      { ...personal, healthTiers: {} },
      stats,
    ),
  ).toBe(0);
});
