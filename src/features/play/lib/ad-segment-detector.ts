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

const FRAME_GRID_STEP = 0.04;
const EXACT_GRID_TOLERANCE = 0.0005;

function isNearGrid(d: number, step: number): boolean {
  if (d <= 0) return false;
  const snapped = Math.round(d / step) * step;
  return Math.abs(d - snapped) < EXACT_GRID_TOLERANCE;
}

// 源站按固定片数插 DISCONTINUITY，块时长随镜头切分浮动（同一集可在 10–38 秒间），只按片数判定。
function hasPeriodicLayout(segments: DiscontSegment[]): boolean {
  if (segments.length < 8) return false;

  const counts = new Map<number, number>();
  for (const segment of segments) {
    const count = segment.tsDurations.length;
    counts.set(count, (counts.get(count) || 0) + 1);
  }
  let modeCount = 0;
  let modeFragments = 0;
  counts.forEach((value, fragments) => {
    if (value > modeCount) {
      modeCount = value;
      modeFragments = fragments;
    }
  });
  return modeFragments >= 3 && modeCount / segments.length >= 0.7;
}

function detectKnownAdTemplates(
  segments: DiscontSegment[],
  templates: readonly (readonly number[])[],
): Set<number> {
  const result = new Set<number>();
  segments.forEach((segment, index) => {
    const durations = segment.tsDurations;
    if (
      templates.some(
        (template) =>
          template.length === durations.length &&
          template.every(
            (duration, i) =>
              Math.abs(duration - durations[i]) < EXACT_GRID_TOLERANCE,
          ),
      )
    ) {
      result.add(index);
    }
  });
  return result;
}

// 由粗到细；更细的网格包含更粗网格的点，同覆盖率时取先出现的粗网格。
const CONTENT_FRAME_STEPS = [
  FRAME_GRID_STEP,
  1 / 24,
  1001 / 24000,
  1 / 30,
  1001 / 30000,
  1 / 50,
  1 / 60,
  1001 / 60000,
];

function detectContentFrameStep(segments: DiscontSegment[]): number | null {
  const durations = segments.flatMap((segment) => segment.tsDurations);
  let bestStep: number | null = null;
  let bestCoverage = 0;
  for (const step of CONTENT_FRAME_STEPS) {
    const coverage =
      durations.filter((d) => isNearGrid(d, step)).length / durations.length;
    if (coverage > bestCoverage) {
      bestStep = step;
      bestCoverage = coverage;
    }
  }
  return bestCoverage >= 0.8 ? bestStep : null;
}

// 广告素材按 25fps 切片，EXTINF 是 0.04 的精确倍数。正片换成其他帧率时，广告块会带出
// 不在正片帧网格上的时长（23.976fps 正片里的 4.000、24fps 正片里的 5.48）；整秒对 24fps
// 正片仍是整帧，只看 0.04 网格会误删。正片本身是 25fps 或无法确定帧率时不判定。
function detectFrameGridClips(segments: DiscontSegment[]): Set<number> {
  const result = new Set<number>();
  const contentStep = detectContentFrameStep(segments);
  if (contentStep === null || contentStep === FRAME_GRID_STEP) return result;

  segments.forEach((segment, index) => {
    if (
      segment.tsDurations.length >= 2 &&
      segment.tsDurations.every((d) => isNearGrid(d, FRAME_GRID_STEP)) &&
      segment.tsDurations.some((d) => !isNearGrid(d, contentStep))
    ) {
      result.add(index);
    }
  });
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

function applyAdFilterStrategy(
  m3u8Content: string,
  originM3u8Url: string,
  strategy: SourceAdFilterStrategy,
): string {
  if (!m3u8Content.includes('#EXT-X-DISCONTINUITY')) return m3u8Content;

  const { lines, segments } = parseDiscontinuitySegments(m3u8Content);
  if (segments.length < 4) return m3u8Content;

  const adSet = new Set<number>();
  if (strategyUsesSignal(strategy, 'known-ad-templates')) {
    detectKnownAdTemplates(segments, strategy.adTemplates).forEach((index) =>
      adSet.add(index),
    );
  }
  if (strategyUsesSignal(strategy, 'frame-grid-clips')) {
    detectFrameGridClips(segments).forEach((index) => adSet.add(index));
  }
  if (strategyUsesSignal(strategy, 'host-anomaly')) {
    detectByHostAnomaly(
      segments,
      resolveSegmentAssetUri(originM3u8Url),
    ).forEach((index) => adSet.add(index));
  }

  if (
    strategy.timeline === 'continuous-periodic' &&
    hasPeriodicLayout(segments)
  ) {
    return rebuildContinuousPlaylist(lines, segments, adSet);
  }
  if (adSet.size === 0) return m3u8Content;
  return removeAdSegmentsKeepingDiscontinuities(lines, segments, adSet);
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
