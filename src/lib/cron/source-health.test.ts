/** @jest-environment node */

import { getConfigForRead } from '@/lib/config';
import { probeSourceSearch } from '@/lib/downstream';
import { flushSourceHealthSearch } from '@/lib/source-health.server';
import {
  SOURCE_HEALTH_PROBE_CONCURRENCY,
  SOURCE_HEALTH_PROBE_KEYWORDS,
  SOURCE_HEALTH_PROBE_KEYWORDS_PER_RUN,
} from '@/lib/source-quality-policy';

import {
  getSourceHealthProbeKeywords,
  probeConfiguredSources,
} from './source-health';

jest.mock('@/lib/config', () => ({ getConfigForRead: jest.fn() }));
jest.mock('@/lib/downstream', () => ({ probeSourceSearch: jest.fn() }));
jest.mock('@/lib/source-health.server', () => ({
  flushSourceHealthSearch: jest.fn(),
}));

const configMock = getConfigForRead as jest.Mock;
const probeMock = probeSourceSearch as jest.Mock;
const flushMock = flushSourceHealthSearch as jest.Mock;
const now = new Date('2026-11-04T00:00:00Z');
const site = (key: string, disabled = false) => ({
  key,
  name: key,
  api: `https://${key}.example/api`,
  disabled,
});

beforeEach(() => {
  jest.resetAllMocks();
  configMock.mockResolvedValue({ SourceConfig: [] });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('rotates distinct keyword pairs by UTC day and covers the entire list', () => {
  const today = getSourceHealthProbeKeywords(now);
  expect(today).toHaveLength(SOURCE_HEALTH_PROBE_KEYWORDS_PER_RUN);
  expect(new Set(today).size).toBe(today.length);
  expect(
    getSourceHealthProbeKeywords(new Date('2026-11-04T23:59:59Z')),
  ).toEqual(today);
  expect(
    getSourceHealthProbeKeywords(new Date('2026-11-05T07:59:59+08:00')),
  ).toEqual(today);
  expect(
    getSourceHealthProbeKeywords(new Date('2026-11-05T08:00:00+08:00')),
  ).not.toEqual(today);
  const seen = new Set<string>();
  for (let day = 0; day < SOURCE_HEALTH_PROBE_KEYWORDS.length; day++) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() + day);
    getSourceHealthProbeKeywords(date).forEach((keyword) => seen.add(keyword));
  }
  expect([...seen].sort()).toEqual([...SOURCE_HEALTH_PROBE_KEYWORDS].sort());
});

it('probes only enabled sources with both daily keywords then drains the health buffer', async () => {
  const enabled = [site('a'), site('b')];
  configMock.mockResolvedValue({
    SourceConfig: [...enabled, site('disabled', true)],
  });
  await probeConfiguredSources(now);
  expect(configMock).toHaveBeenCalledTimes(1);
  expect(probeMock).toHaveBeenCalledTimes(
    enabled.length * SOURCE_HEALTH_PROBE_KEYWORDS_PER_RUN,
  );
  for (const source of enabled) {
    for (const keyword of getSourceHealthProbeKeywords(now)) {
      expect(probeMock).toHaveBeenCalledWith(source, keyword);
    }
  }
  expect(flushMock).toHaveBeenCalledTimes(2);
  expect(flushMock.mock.invocationCallOrder[0]).toBeGreaterThan(
    Math.max(...probeMock.mock.invocationCallOrder),
  );
});

it('bounds concurrency and keeps processing after one source rejects', async () => {
  const sources = Array.from(
    { length: SOURCE_HEALTH_PROBE_CONCURRENCY + 3 },
    (_, i) => site(`s${i}`),
  );
  configMock.mockResolvedValue({ SourceConfig: sources });
  let active = 0;
  let peak = 0;
  probeMock.mockImplementation(async (source) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    active--;
    if (source.key === 's0') throw new Error('failed source');
  });
  await expect(probeConfiguredSources(now)).resolves.toBeUndefined();
  expect(peak).toBe(SOURCE_HEALTH_PROBE_CONCURRENCY);
  expect(active).toBe(0);
  expect(probeMock).toHaveBeenCalledTimes(
    sources.length * SOURCE_HEALTH_PROBE_KEYWORDS_PER_RUN,
  );
  expect(flushMock).toHaveBeenCalledTimes(2);
});

it('still flushes when configuration fails and contains storage errors', async () => {
  configMock.mockRejectedValue(new Error('config unavailable'));
  flushMock.mockRejectedValue(new Error('storage unavailable'));
  await expect(probeConfiguredSources(now)).resolves.toBeUndefined();
  expect(probeMock).not.toHaveBeenCalled();
  expect(flushMock).toHaveBeenCalledTimes(1);
});

it('flushes even when no sources are enabled', async () => {
  configMock.mockResolvedValue({ SourceConfig: [site('disabled', true)] });
  await probeConfiguredSources(now);
  expect(probeMock).not.toHaveBeenCalled();
  expect(flushMock).toHaveBeenCalledTimes(2);
});
