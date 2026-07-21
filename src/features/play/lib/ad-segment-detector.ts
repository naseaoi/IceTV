import {
  type DiscontSegment,
  parseDiscontinuitySegments,
  rebuildContinuousPlaylist,
  removeAdSegmentsKeepingDiscontinuities,
} from '@/features/play/lib/ad-filter-manifest';
import {
  type ServerAdFilterSignal,
  type SourceAdFilterStrategy,
  getSourceAdFilterStrategy,
  shouldRunServerAdFilter,
} from '@/features/play/lib/ad-filter-strategy-registry';
import { createTimedAbortController } from '@/lib/downstream-sources/shared';
import { fetchWithUrlGuard } from '@/lib/url-guard';
import { getBaseUrl, resolveUrl } from '@/lib/url-resolve';

interface PeriodicLayout {
  fragmentCount: number;
  duration: number;
}

export function shouldRunAdDetection(source: string | null): boolean {
  return shouldRunServerAdFilter(source);
}

function isNearInteger(d: number): boolean {
  if (d <= 0) return false;
  return Math.abs(d - Math.round(d)) < 0.01;
}

function isNearGrid(d: number, step: number): boolean {
  if (d <= 0 || step <= 0) return false;
  const snapped = Math.round(d / step) * step;
  return Math.abs(d - snapped) < 0.01;
}

function integerRatioOfSegment(seg: DiscontSegment): number {
  if (seg.tsDurations.length === 0) return 0;
  const hits = seg.tsDurations.filter(isNearInteger).length;
  return hits / seg.tsDurations.length;
}

function coarseGridRatioOfSegment(seg: DiscontSegment): number {
  if (seg.tsDurations.length === 0) return 0;
  const hits = seg.tsDurations.filter((d) => isNearGrid(d, 0.04)).length;
  return hits / seg.tsDurations.length;
}

function roundedModeShare(seg: DiscontSegment, digits: number): number {
  if (seg.tsDurations.length === 0) return 0;
  const scale = 10 ** digits;
  const counts = new Map<number, number>();
  for (const d of seg.tsDurations) {
    const k = Math.round(d * scale) / scale;
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  let topCount = 0;
  counts.forEach((v) => {
    if (v > topCount) topCount = v;
  });
  return topCount / seg.tsDurations.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mode(values: number[]): { value: number; coverage: number } | null {
  if (values.length === 0) return null;

  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  let modeValue = values[0];
  let modeCount = 0;
  counts.forEach((count, value) => {
    if (count > modeCount) {
      modeValue = value;
      modeCount = count;
    }
  });

  return { value: modeValue, coverage: modeCount / values.length };
}

function detectPeriodicLayout(
  segments: DiscontSegment[],
): PeriodicLayout | null {
  if (segments.length < 8) return null;

  const fragmentMode = mode(
    segments.map((segment) => segment.tsDurations.length),
  );
  if (!fragmentMode || fragmentMode.value < 3 || fragmentMode.coverage < 0.7) {
    return null;
  }

  const fullSegments = segments.filter(
    (segment) => segment.tsDurations.length === fragmentMode.value,
  );
  const duration = median(
    fullSegments
      .map((segment) => segment.duration)
      .filter((value) => value > 0),
  );
  if (duration <= 0) return null;

  const tolerance = Math.max(1.5, duration * 0.12);
  const durationCoverage =
    fullSegments.filter(
      (segment) => Math.abs(segment.duration - duration) <= tolerance,
    ).length / fullSegments.length;
  if (durationCoverage < 0.55) return null;

  return { fragmentCount: fragmentMode.value, duration };
}

function looksLikeAdEdgeBlock(segment: DiscontSegment): boolean {
  if (segment.tsDurations.length === 0) return false;
  const intRatio = integerRatioOfSegment(segment);
  const coarseRatio = coarseGridRatioOfSegment(segment);
  if (intRatio >= 0.6) return true;
  if (coarseRatio >= 0.85 && intRatio >= 0.3) return true;
  if (segment.tsDurations.length >= 2 && intRatio >= 0.5) return true;
  return false;
}

function detectShortEdgeBlocks(
  segments: DiscontSegment[],
  layout: PeriodicLayout,
): Set<number> {
  const result = new Set<number>();
  const durationLimit = layout.duration * 0.25;

  const isCandidate = (segment: DiscontSegment) =>
    segment.duration > 0 &&
    segment.duration < durationLimit &&
    segment.tsDurations.length < layout.fragmentCount &&
    looksLikeAdEdgeBlock(segment);

  for (let index = 0; index < segments.length; index += 1) {
    if (!isCandidate(segments[index])) break;
    result.add(index);
  }

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (!isCandidate(segments[index])) break;
    result.add(index);
  }

  return result;
}

function detectByPeriodicDurationProfile(
  segments: DiscontSegment[],
  layout: PeriodicLayout,
): Set<number> {
  const result = new Set<number>();
  const baselineFragmentDuration = layout.duration / layout.fragmentCount;
  const minimumModeShift = Math.max(0.5, baselineFragmentDuration * 0.1);
  const neighborTolerance = Math.max(1, layout.duration * 0.08);

  for (let index = 1; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (segment.tsDurations.length !== layout.fragmentCount) continue;
    if (segment.duration >= layout.duration * 0.9) continue;
    if (coarseGridRatioOfSegment(segment) < 0.85) continue;

    const durationMode = mode(
      segment.tsDurations.map((duration) => Math.round(duration * 100)),
    );
    if (!durationMode || durationMode.coverage < 0.5) continue;

    const fragmentDuration = durationMode.value / 100;
    if (baselineFragmentDuration - fragmentDuration < minimumModeShift) {
      continue;
    }

    const previous = segments[index - 1];
    const next = segments[index + 1];
    if (
      Math.abs(previous.duration - layout.duration) > neighborTolerance ||
      Math.abs(next.duration - layout.duration) > neighborTolerance
    ) {
      continue;
    }

    result.add(index);
  }

  return result;
}

function detectByLocalDurationShift(segments: DiscontSegment[]): Set<number> {
  const result = new Set<number>();
  if (segments.length < 8) return result;

  const typicalDurations = segments.map((segment) =>
    median(segment.tsDurations.filter((duration) => duration > 0)),
  );
  const baseline = median(typicalDurations.filter((duration) => duration > 0));
  if (baseline <= 0) return result;

  const baselineTolerance = Math.max(0.15, baseline * 0.05);
  const baselineCoverage =
    typicalDurations.filter(
      (duration) => Math.abs(duration - baseline) <= baselineTolerance,
    ).length / typicalDurations.length;
  if (baselineCoverage < 0.7) return result;

  const minimumShift = Math.max(0.5, baseline * 0.12);
  for (let i = 1; i < segments.length - 1; i++) {
    const segment = segments[i];
    const previous = segments[i - 1];
    const next = segments[i + 1];
    if (segment.tsDurations.length < 4) continue;
    if (
      segment.tsDurations.length !== previous.tsDurations.length ||
      segment.tsDurations.length !== next.tsDurations.length
    ) {
      continue;
    }

    const typicalDuration = typicalDurations[i];
    if (baseline - typicalDuration < minimumShift) continue;
    if (
      Math.abs(typicalDurations[i - 1] - baseline) > baselineTolerance ||
      Math.abs(typicalDurations[i + 1] - baseline) > baselineTolerance
    ) {
      continue;
    }

    const uniformTolerance = Math.max(0.15, typicalDuration * 0.05);
    const uniformCoverage =
      segment.tsDurations.filter(
        (duration) => Math.abs(duration - typicalDuration) <= uniformTolerance,
      ).length / segment.tsDurations.length;
    if (uniformCoverage < 0.8) continue;

    const neighborDuration = (previous.duration + next.duration) / 2;
    if (neighborDuration <= 0 || segment.duration > neighborDuration * 0.9) {
      continue;
    }

    result.add(i);
  }

  return result;
}

function detectByExtinfIntegerPattern(segments: DiscontSegment[]): Set<number> {
  const result = new Set<number>();
  if (segments.length < 3) return result;

  const ratios = segments.map(integerRatioOfSegment);
  const integerBaseline = median(ratios);
  const coarseRatios = segments.map(coarseGridRatioOfSegment);
  const coarseBaseline = median(coarseRatios);

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.tsDurations.length < 3) continue;

    const ratio = ratios[i];

    const counts = new Map<number, number>();
    for (const d of seg.tsDurations) {
      if (!isNearInteger(d)) continue;
      const k = Math.round(d);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let topCount = 0;
    counts.forEach((v) => {
      if (v > topCount) topCount = v;
    });
    const topShare = topCount / seg.tsDurations.length;

    const coarseRatio = coarseRatios[i];
    const coarseModeShare = roundedModeShare(seg, 2);

    const matchedIntegerPattern =
      ratio >= 0.85 &&
      topShare >= 0.5 &&
      !(integerBaseline >= 0.4 && ratio - integerBaseline < 0.5);

    const matchedCoarseGridPattern =
      seg.tsDurations.length >= 4 &&
      coarseRatio >= 0.85 &&
      coarseModeShare >= 0.5 &&
      ratio >= 0.45 &&
      !(coarseBaseline >= 0.35 && coarseRatio - coarseBaseline < 0.5);

    // 等长伪装广告：0.04s 网格 + 部分整数 EXTINF
    const integerHits = ratio * seg.tsDurations.length;
    const matchedCamouflagedGridPattern =
      seg.tsDurations.length >= 4 &&
      integerBaseline < 0.25 &&
      coarseBaseline < 0.5 &&
      coarseRatio >= 0.9 &&
      ratio >= 0.3 &&
      ratio < 0.85 &&
      topShare >= 0.3 &&
      integerHits >= 2;

    if (
      matchedIntegerPattern ||
      matchedCoarseGridPattern ||
      matchedCamouflagedGridPattern
    ) {
      result.add(i);
    }
  }

  return result;
}

function isAbsoluteUrl(p: string): boolean {
  return /^https?:\/\//i.test(p);
}

function collectSegmentHosts(seg: DiscontSegment, baseUrl: string): string[] {
  const hosts: string[] = [];
  for (const p of seg.tsPaths) {
    try {
      hosts.push(new URL(p, baseUrl).host.toLowerCase());
    } catch {}
  }
  return hosts;
}

function detectByHostAnomaly(
  segments: DiscontSegment[],
  baseUrl: string,
): Set<number> {
  const result = new Set<number>();

  const globalCounts = new Map<string, number>();
  let totalTs = 0;
  for (const s of segments) {
    totalTs += s.tsPaths.length;
    for (const h of collectSegmentHosts(s, baseUrl)) {
      globalCounts.set(h, (globalCounts.get(h) || 0) + 1);
    }
  }
  if (totalTs === 0) return result;

  let dominantHost: string | null = null;
  let dominantCount = 0;
  globalCounts.forEach((v, k) => {
    if (v > dominantCount) {
      dominantHost = k;
      dominantCount = v;
    }
  });
  if (!dominantHost || dominantCount / totalTs < 0.6) return result;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    const absCount = seg.tsPaths.filter(isAbsoluteUrl).length;
    if (absCount < 2) continue;
    const hosts = collectSegmentHosts(seg, baseUrl);
    if (hosts.length === 0) continue;
    if (hosts.every((h) => h !== dominantHost)) {
      result.add(i);
    }
  }
  return result;
}

function computeDurationMode(segments: DiscontSegment[]): number | null {
  if (segments.length < 3) return null;

  const buckets = new Map<number, number>();
  for (const s of segments) {
    const key = Math.round(s.duration * 10) / 10;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const sorted = Array.from(buckets.entries()).sort((a, b) => b[1] - a[1]);
  const [modeKey, modeCount] = sorted[0];

  if (modeCount / segments.length < 0.6) return null;
  return modeKey;
}

async function fetchTsSize(url: string, ua: string): Promise<number> {
  const abortState = createTimedAbortController(undefined, 5000);
  try {
    const res = await fetchWithUrlGuard(url, {
      method: 'GET',
      headers: { 'User-Agent': ua, Range: 'bytes=0-187' },
      signal: abortState.signal,
      cache: 'no-store',
      redirect: 'follow',
    });
    if (!res.ok || res.status !== 206) return 0;
    const cr = res.headers.get('content-range') || '';
    const total = Number.parseInt(cr.split('/')[1] || '0', 10);

    try {
      await res.arrayBuffer();
    } catch {}
    return Number.isFinite(total) ? total : 0;
  } catch {
    return 0;
  } finally {
    abortState.cleanup();
  }
}

async function computeSegmentBitrate(
  seg: DiscontSegment,
  baseUrl: string,
  ua: string,
): Promise<number> {
  if (seg.duration <= 0 || seg.tsPaths.length === 0) return 0;

  const sizes = await Promise.all(
    seg.tsPaths.map((p) => fetchTsSize(resolveUrl(baseUrl, p), ua)),
  );
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return (total * 8) / seg.duration / 1000;
}

async function computeBaselineBitrate(
  segments: DiscontSegment[],
  mode: number,
  baseUrl: string,
  ua: string,
): Promise<number> {
  const candidates = segments.filter(
    (s) => Math.abs(s.duration - mode) < 0.5 && s.tsPaths.length > 0,
  );
  if (candidates.length === 0) return 0;

  const step = Math.max(1, Math.floor(candidates.length / 5));
  const sampled: DiscontSegment[] = [];
  for (let i = 0; i < candidates.length && sampled.length < 5; i += step) {
    sampled.push(candidates[i]);
  }

  const rates = await Promise.all(
    sampled.map((s) => computeSegmentBitrate(s, baseUrl, ua)),
  );
  const valid = rates.filter((r) => r > 0).sort((a, b) => a - b);
  if (valid.length === 0) return 0;
  return valid[Math.floor(valid.length / 2)];
}

function collectBitrateSuspectIndices(
  segments: DiscontSegment[],
  durationMode: number | null,
): number[] {
  const suspiciousIdx: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.tsPaths.length === 0) continue;
    if (
      i === segments.length - 1 &&
      segment.tsPaths.length === 1 &&
      segment.duration < 5
    ) {
      continue;
    }

    const durationOutlier =
      durationMode !== null && Math.abs(segment.duration - durationMode) >= 1;
    const intRatio = integerRatioOfSegment(segment);
    const coarseRatio = coarseGridRatioOfSegment(segment);
    const weakExtinfPattern =
      segment.tsDurations.length >= 4 && intRatio >= 0.3 && coarseRatio >= 0.85;

    if (durationOutlier || weakExtinfPattern) {
      suspiciousIdx.push(i);
    }
  }
  return suspiciousIdx;
}

async function detectByBitrate(
  segments: DiscontSegment[],
  baseUrl: string,
  ua: string,
): Promise<Set<number>> {
  const result = new Set<number>();

  const durationMode = computeDurationMode(segments);
  const suspiciousIdx = collectBitrateSuspectIndices(segments, durationMode);
  if (suspiciousIdx.length === 0) return result;

  const baselineMode =
    durationMode ??
    median(segments.map((segment) => segment.duration).filter((d) => d > 0));
  if (baselineMode <= 0) return result;

  const [baseline, suspectRates] = await Promise.all([
    computeBaselineBitrate(segments, baselineMode, baseUrl, ua),
    Promise.all(
      suspiciousIdx.map((i) => computeSegmentBitrate(segments[i], baseUrl, ua)),
    ),
  ]);
  if (baseline <= 0) return result;

  suspiciousIdx.forEach((segIdx, k) => {
    const r = suspectRates[k];
    if (r > 0 && r > baseline * 2) result.add(segIdx);
  });
  return result;
}

function strategyUsesSignal(
  strategy: SourceAdFilterStrategy,
  signal: ServerAdFilterSignal,
): boolean {
  return strategy.server?.signals.includes(signal) === true;
}

function rebuildFilteredPlaylist(
  lines: string[],
  segments: DiscontSegment[],
  adIndices: Set<number>,
  strategy: SourceAdFilterStrategy,
  periodicLayout: PeriodicLayout | null,
): string {
  if (periodicLayout && strategy.server?.timeline === 'continuous-periodic') {
    return rebuildContinuousPlaylist(lines, segments, adIndices);
  }
  return removeAdSegmentsKeepingDiscontinuities(lines, segments, adIndices);
}

async function applyServerAdFilterStrategy(
  m3u8Content: string,
  originM3u8Url: string,
  ua: string,
  strategy: SourceAdFilterStrategy,
): Promise<string> {
  if (!strategy.server) return m3u8Content;
  if (!m3u8Content.includes('#EXT-X-DISCONTINUITY')) return m3u8Content;

  const { lines, segments } = parseDiscontinuitySegments(m3u8Content);
  if (segments.length < 4) return m3u8Content;

  const baseUrl = getBaseUrl(originM3u8Url);
  const periodicLayout = detectPeriodicLayout(segments);

  const adSet = new Set<number>();
  if (strategyUsesSignal(strategy, 'extinf-pattern')) {
    detectByExtinfIntegerPattern(segments).forEach((index) => adSet.add(index));
  }
  if (strategyUsesSignal(strategy, 'local-duration-shift')) {
    detectByLocalDurationShift(segments).forEach((index) => adSet.add(index));
  }
  if (strategyUsesSignal(strategy, 'host-anomaly')) {
    detectByHostAnomaly(segments, baseUrl).forEach((index) => adSet.add(index));
  }
  if (periodicLayout) {
    if (strategyUsesSignal(strategy, 'periodic-duration-profile')) {
      detectByPeriodicDurationProfile(segments, periodicLayout).forEach(
        (index) => adSet.add(index),
      );
    }
    if (strategyUsesSignal(strategy, 'short-edge-blocks')) {
      detectShortEdgeBlocks(segments, periodicLayout).forEach((index) =>
        adSet.add(index),
      );
    }
  }

  if (adSet.size > 0) {
    return rebuildFilteredPlaylist(
      lines,
      segments,
      adSet,
      strategy,
      periodicLayout,
    );
  }

  if (strategyUsesSignal(strategy, 'bitrate-fallback')) {
    try {
      const bitrateSet = await detectByBitrate(segments, baseUrl, ua);
      if (bitrateSet.size > 0) {
        return rebuildFilteredPlaylist(
          lines,
          segments,
          bitrateSet,
          strategy,
          periodicLayout,
        );
      }
    } catch {}
  }

  if (periodicLayout && strategy.server.timeline === 'continuous-periodic') {
    return rebuildContinuousPlaylist(lines, segments, new Set());
  }
  return m3u8Content;
}

export async function filterM3U8AdsForSource(
  m3u8Content: string,
  originM3u8Url: string,
  ua: string,
  source: string | null,
): Promise<string> {
  const strategy = getSourceAdFilterStrategy(source);
  if (strategy?.execution !== 'server') return m3u8Content;
  return applyServerAdFilterStrategy(m3u8Content, originM3u8Url, ua, strategy);
}

export async function stripAdSegmentsByPhysicalSignal(
  m3u8Content: string,
  originM3u8Url: string,
  ua: string,
): Promise<string> {
  const strategy = getSourceAdFilterStrategy('rycj');
  if (!strategy) return m3u8Content;
  return applyServerAdFilterStrategy(m3u8Content, originM3u8Url, ua, strategy);
}
