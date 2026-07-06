import { createTimedAbortController } from '@/lib/downstream-sources/shared';
import { fetchWithUrlGuard } from '@/lib/url-guard';
import { getBaseUrl, resolveUrl } from '@/lib/url-resolve';

interface DiscontSegment {
  lineIndices: number[];

  tsPaths: string[];

  tsDurations: number[];

  duration: number;
}

export function shouldRunAdDetection(source: string | null): boolean {
  if (!source) return false;

  return source === 'rycj';
}

function parseSegments(m3u8Content: string): {
  lines: string[];
  segments: DiscontSegment[];
} {
  const lines = m3u8Content.split('\n');
  const segments: DiscontSegment[] = [];
  let current: DiscontSegment = {
    lineIndices: [],
    tsPaths: [],
    tsDurations: [],
    duration: 0,
  };
  let pendingDur = 0;
  let pendingExtinfIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();

    if (t === '#EXT-X-DISCONTINUITY') {
      if (current.tsPaths.length > 0) {
        segments.push(current);
      }
      current = {
        lineIndices: [],
        tsPaths: [],
        tsDurations: [],
        duration: 0,
      };
      pendingDur = 0;
      pendingExtinfIdx = -1;
      continue;
    }

    if (t.startsWith('#EXTINF:')) {
      const raw = t.slice(8).split(',')[0]?.trim() || '';
      pendingDur = Number.parseFloat(raw) || 0;
      pendingExtinfIdx = i;
      continue;
    }

    if (t && !t.startsWith('#')) {
      if (pendingExtinfIdx >= 0) current.lineIndices.push(pendingExtinfIdx);
      current.lineIndices.push(i);
      current.tsPaths.push(t);
      current.tsDurations.push(pendingDur);
      current.duration += pendingDur;
      pendingDur = 0;
      pendingExtinfIdx = -1;
    }
  }
  if (current.tsPaths.length > 0) segments.push(current);

  return { lines, segments };
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

    if (matchedIntegerPattern || matchedCoarseGridPattern) {
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

async function detectByBitrate(
  segments: DiscontSegment[],
  baseUrl: string,
  ua: string,
): Promise<Set<number>> {
  const result = new Set<number>();

  const mode = computeDurationMode(segments);
  if (mode === null) return result;

  const suspiciousIdx: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (Math.abs(s.duration - mode) < 1) continue;

    if (i === segments.length - 1 && s.tsPaths.length === 1 && s.duration < 5) {
      continue;
    }
    suspiciousIdx.push(i);
  }
  if (suspiciousIdx.length === 0) return result;

  const [baseline, suspectRates] = await Promise.all([
    computeBaselineBitrate(segments, mode, baseUrl, ua),
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

function rebuildM3U8(
  lines: string[],
  segments: DiscontSegment[],
  adIndices: Set<number>,
): string {
  if (adIndices.size === 0) return lines.join('\n');

  const dropLines = new Set<number>();
  adIndices.forEach((idx) => {
    for (const li of segments[idx].lineIndices) dropLines.add(li);
  });

  const out: string[] = [];
  let lastWasDisc = false;
  for (let i = 0; i < lines.length; i++) {
    if (dropLines.has(i)) continue;
    const t = lines[i].trim();
    if (t === '#EXT-X-DISCONTINUITY') {
      if (lastWasDisc) continue;
      lastWasDisc = true;
    } else if (t !== '') {
      lastWasDisc = false;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

export async function stripAdSegmentsByPhysicalSignal(
  m3u8Content: string,
  originM3u8Url: string,
  ua: string,
): Promise<string> {
  if (!m3u8Content.includes('#EXT-X-DISCONTINUITY')) return m3u8Content;

  const { lines, segments } = parseSegments(m3u8Content);
  if (segments.length < 4) return m3u8Content;

  const baseUrl = getBaseUrl(originM3u8Url);

  const adSet = new Set<number>();
  detectByExtinfIntegerPattern(segments).forEach((i) => adSet.add(i));
  detectByHostAnomaly(segments, baseUrl).forEach((i) => adSet.add(i));

  if (adSet.size > 0) {
    return rebuildM3U8(lines, segments, adSet);
  }

  try {
    const bitrateSet = await detectByBitrate(segments, baseUrl, ua);
    if (bitrateSet.size > 0) {
      return rebuildM3U8(lines, segments, bitrateSet);
    }
  } catch {}

  return m3u8Content;
}
