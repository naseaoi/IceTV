import {
  type DiscontSegment,
  parseDiscontinuitySegments,
  rebuildContinuousPlaylist,
  removeAdSegmentsKeepingDiscontinuities,
} from '@/features/play/lib/ad-filter-manifest';
import {
  type AdFilterSignal,
  type SourceAdFilterStrategy,
  getSourceAdFilterStrategy,
} from '@/features/play/lib/ad-filter-strategy-registry';
import {
  filterAdsFromM3U8,
  resolveSegmentAssetUri,
} from '@/features/play/lib/playUtils';

interface PeriodicLayout {
  fragmentCount: number;
  duration: number;
}

function isNearInteger(d: number): boolean {
  if (d <= 0) return false;
  return Math.abs(d - Math.round(d)) < 0.01;
}

const FRAME_GRID_STEP = 0.04;
const EXACT_GRID_TOLERANCE = 0.0005;

function isNearGrid(d: number, step: number, tolerance = 0.01): boolean {
  if (d <= 0 || step <= 0) return false;
  const snapped = Math.round(d / step) * step;
  return Math.abs(d - snapped) < tolerance;
}

function exactFrameGridRatioOfSegment(seg: DiscontSegment): number {
  if (seg.tsDurations.length === 0) return 0;
  const hits = seg.tsDurations.filter((d) =>
    isNearGrid(d, FRAME_GRID_STEP, EXACT_GRID_TOLERANCE),
  ).length;
  return hits / seg.tsDurations.length;
}

function integerRatioOfSegment(seg: DiscontSegment): number {
  if (seg.tsDurations.length === 0) return 0;
  const hits = seg.tsDurations.filter(isNearInteger).length;
  return hits / seg.tsDurations.length;
}

function coarseGridRatioOfSegment(seg: DiscontSegment): number {
  if (seg.tsDurations.length === 0) return 0;
  const hits = seg.tsDurations.filter((d) =>
    isNearGrid(d, FRAME_GRID_STEP),
  ).length;
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
  // 广告素材按 25fps 切片，EXTINF 是 0.04 的精确倍数；23.976fps 正片几乎落不到该网格上。
  // 正片本身在网格上时（25fps 源）该特征失去区分度，只保留短块规则。
  const contentOffFrameGrid =
    median(segments.map(exactFrameGridRatioOfSegment)) < 0.2;

  const looksLikeFrameGridClip = (segment: DiscontSegment) =>
    contentOffFrameGrid &&
    segment.tsDurations.length >= 2 &&
    segment.duration < layout.duration &&
    exactFrameGridRatioOfSegment(segment) === 1 &&
    segment.tsDurations.some((d) => isNearGrid(d, 1, EXACT_GRID_TOLERANCE));

  const isCandidate = (segment: DiscontSegment) =>
    segment.duration > 0 &&
    segment.tsDurations.length < layout.fragmentCount &&
    ((segment.duration < durationLimit && looksLikeAdEdgeBlock(segment)) ||
      looksLikeFrameGridClip(segment));

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

function collectSegmentHosts(seg: DiscontSegment, baseUrl: string): string[] {
  const hosts: string[] = [];
  for (const p of seg.tsPaths) {
    try {
      hosts.push(
        new URL(resolveSegmentAssetUri(p), baseUrl).host.toLowerCase(),
      );
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

    const hosts = collectSegmentHosts(seg, baseUrl);
    if (hosts.length < 2) continue;
    if (hosts.every((h) => h !== dominantHost)) {
      result.add(i);
    }
  }
  return result;
}

function strategyUsesSignal(
  strategy: SourceAdFilterStrategy,
  signal: AdFilterSignal,
): boolean {
  return strategy.signals.includes(signal);
}

function rebuildFilteredPlaylist(
  lines: string[],
  segments: DiscontSegment[],
  adIndices: Set<number>,
  strategy: SourceAdFilterStrategy,
  periodicLayout: PeriodicLayout | null,
): string {
  if (periodicLayout && strategy.timeline === 'continuous-periodic') {
    return rebuildContinuousPlaylist(lines, segments, adIndices);
  }
  return removeAdSegmentsKeepingDiscontinuities(lines, segments, adIndices);
}

function applyAdFilterStrategy(
  m3u8Content: string,
  originM3u8Url: string,
  strategy: SourceAdFilterStrategy,
): string {
  if (!m3u8Content.includes('#EXT-X-DISCONTINUITY')) return m3u8Content;

  const { lines, segments } = parseDiscontinuitySegments(m3u8Content);
  if (segments.length < 4) return m3u8Content;

  const baseUrl = resolveSegmentAssetUri(originM3u8Url);
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

  if (periodicLayout && strategy.timeline === 'continuous-periodic') {
    return rebuildContinuousPlaylist(lines, segments, new Set());
  }
  return m3u8Content;
}

export function filterM3U8AdsForSource(
  m3u8Content: string,
  manifestUrl: string,
  source: string | null | undefined,
): string {
  const strategy = getSourceAdFilterStrategy(source);
  if (!strategy) return filterAdsFromM3U8(m3u8Content);
  return applyAdFilterStrategy(m3u8Content, manifestUrl, strategy);
}
