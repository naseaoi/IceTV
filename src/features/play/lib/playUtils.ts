export type SourceTestResult = {
  quality: string;
  loadSpeed: string;
  pingTime: number;
};

export type AdRange = {
  start: number;
  end: number;
  reason: string;
};

// 广告 URL 关键词：覆盖常见命名（ad/ads/promo），以及第三方广告 SDK
// （vast/vmap/ima/doubleclick）和常见广告位命名（banner/sponsor/bumper）。
// 用 (^|分隔符) 边界限定，避免误伤 "advance/header" 等正常词。
export const AD_KEYWORD_RE =
  /(^|[\/_.?=&-])(ad|ads|adbreak|advert|commercial|promo|preroll|midroll|postroll|bumper|banner|sponsor|vast|vmap|ima|doubleclick|splash)($|[\/_.?=&-])/i;
// 广告 HLS 标签：除 HLS 标准 SCTE-35 / CUE-OUT / DATERANGE 外，
// 补充 Adobe/部分国内 CDN 常用的 OATCLS-SCTE35、SPLICEPOINT-SCTE35、
// 以及非标的 ASSET / BREAK / AD-START / AD-END / TYPE=AD。
export const AD_TAG_RE =
  /#EXT-X-CUE-OUT|#EXT-X-DATERANGE|#EXT-OATCLS-SCTE35|#EXT-X-SPLICEPOINT-SCTE35|#EXT-X-ASSET|#EXT-X-BREAK|#EXT-X-AD-(?:START|END|SIGNAL)|SCTE35|X-ASSET-LIST|CLASS="?ad"?|TYPE="?AD"?/i;

export function calculateSourceScore(
  testResult: SourceTestResult,
  maxSpeed: number,
  minPing: number,
  maxPing: number,
): number {
  let score = 0;

  const qualityScore = (() => {
    switch (testResult.quality) {
      case '4K':
        return 100;
      case '2K':
        return 85;
      case '1080p':
        return 75;
      case '720p':
        return 60;
      case '480p':
        return 40;
      case 'SD':
        return 20;
      default:
        return 0;
    }
  })();
  score += qualityScore * 0.4;

  const speedScore = (() => {
    const speedStr = testResult.loadSpeed;
    if (speedStr === '未知' || speedStr === '测量中...') return 30;

    const match = speedStr.match(/^([\d.]+)\s*(Mbps|KB\/s|MB\/s)$/);
    if (!match) return 30;

    const value = parseFloat(match[1]);
    const unit = match[2];
    // 统一转换为 KB/s 用于内部评分比较
    let speedKBps: number;
    if (unit === 'Mbps') speedKBps = (value * 1024) / 8;
    else speedKBps = unit === 'MB/s' ? value * 1024 : value;
    const speedRatio = speedKBps / maxSpeed;
    return Math.min(100, Math.max(0, speedRatio * 100));
  })();
  score += speedScore * 0.4;

  const pingScore = (() => {
    const ping = testResult.pingTime;
    if (ping <= 0) return 0;
    if (maxPing === minPing) return 100;
    const pingRatio = (maxPing - ping) / (maxPing - minPing);
    return Math.min(100, Math.max(0, pingRatio * 100));
  })();
  score += pingScore * 0.2;

  return Math.round(score * 100) / 100;
}

function parseExtinfDuration(line: string): number {
  const raw = line.replace('#EXTINF:', '').split(',')[0]?.trim() || '';
  const duration = Number.parseFloat(raw);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return duration;
}

export function isLikelyAdUri(uri: string): boolean {
  if (!uri) return false;
  const normalized = uri.toLowerCase();
  if (AD_KEYWORD_RE.test(normalized)) return true;

  try {
    const base =
      typeof window !== 'undefined'
        ? window.location.origin
        : 'http://localhost';
    const parsed = new URL(uri, base);
    if (AD_KEYWORD_RE.test(parsed.hostname)) return true;
    let matched = false;
    parsed.searchParams.forEach((value, key) => {
      if (matched) return;
      if (AD_KEYWORD_RE.test(`${key}=${value}`)) {
        matched = true;
      }
    });
    if (matched) return true;
  } catch {
    return false;
  }
  return false;
}

export function mergeAdRanges(ranges: AdRange[]): AdRange[] {
  if (!ranges.length) return [];

  const sorted = [...ranges]
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start);

  if (!sorted.length) return [];

  const merged: AdRange[] = [];
  for (const range of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push({ ...range });
      continue;
    }
    if (range.start <= prev.end + 0.35) {
      prev.end = Math.max(prev.end, range.end);
      if (prev.reason !== range.reason) {
        prev.reason = `${prev.reason}|${range.reason}`;
      }
    } else {
      merged.push({ ...range });
    }
  }

  return merged;
}

type ParsedDiscontinuitySegment = {
  lines: string[];
  duration: number;
  hasAdTag: boolean;
  hasAdUri: boolean;
  tsDurations: number[];
};

type SegmentAnalysis = {
  maxDuration: number;
  integerRatios: number[];
  coarseRatios: number[];
  coarseBaseline: number;
  roundedModeShares: number[];
};

function parseDiscontinuitySegments(
  m3u8Content: string,
): ParsedDiscontinuitySegment[] {
  const lines = m3u8Content.split('\n');
  const segments: ParsedDiscontinuitySegment[] = [];
  let current: ParsedDiscontinuitySegment = {
    lines: [],
    duration: 0,
    hasAdTag: false,
    hasAdUri: false,
    tsDurations: [],
  };
  let pendingDuration = 0;
  let cueOutActive = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // DISCONTINUITY 本身只用来划分区间，不应写回原区间内容。
    if (line === '#EXT-X-DISCONTINUITY') {
      if (current.lines.length > 0) {
        segments.push(current);
        current = {
          lines: [],
          duration: 0,
          hasAdTag: false,
          hasAdUri: false,
          tsDurations: [],
        };
      }
      cueOutActive = false;
      continue;
    }

    current.lines.push(rawLine);

    if (line.startsWith('#EXTINF:')) {
      pendingDuration = parseExtinfDuration(line);
      continue;
    }

    if (line.startsWith('#')) {
      if (line.startsWith('#EXT-X-CUE-IN')) {
        cueOutActive = false;
      } else if (line.startsWith('#EXT-X-CUE-OUT') || AD_TAG_RE.test(line)) {
        cueOutActive = true;
        current.hasAdTag = true;
      }
      continue;
    }

    if (pendingDuration > 0) {
      current.duration += pendingDuration;
      current.tsDurations.push(pendingDuration);
      pendingDuration = 0;
    }
    if (cueOutActive) {
      current.hasAdTag = true;
    }
    if (isLikelyAdUri(line)) {
      current.hasAdUri = true;
    }
  }

  if (current.lines.length > 0) {
    segments.push(current);
  }

  return segments;
}

function isNearInteger(value: number): boolean {
  if (value <= 0) return false;
  return Math.abs(value - Math.round(value)) < 0.01;
}

function isNearGrid(value: number, step: number): boolean {
  if (value <= 0 || step <= 0) return false;
  const snapped = Math.round(value / step) * step;
  return Math.abs(value - snapped) < 0.01;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function calculateRoundedModeShare(values: number[], digits: number): number {
  if (!values.length) return 0;
  const scale = 10 ** digits;
  const counts = new Map<number, number>();
  values.forEach((value) => {
    const rounded = Math.round(value * scale) / scale;
    counts.set(rounded, (counts.get(rounded) || 0) + 1);
  });

  let topCount = 0;
  counts.forEach((count) => {
    if (count > topCount) topCount = count;
  });
  return topCount / values.length;
}

function analyzeSegments(
  segments: ParsedDiscontinuitySegment[],
): SegmentAnalysis {
  const integerRatios = segments.map((segment) => {
    if (!segment.tsDurations.length) return 0;
    return (
      segment.tsDurations.filter((duration) => isNearInteger(duration)).length /
      segment.tsDurations.length
    );
  });

  const coarseRatios = segments.map((segment) => {
    if (!segment.tsDurations.length) return 0;
    return (
      segment.tsDurations.filter((duration) => isNearGrid(duration, 0.04))
        .length / segment.tsDurations.length
    );
  });

  return {
    maxDuration: Math.max(...segments.map((segment) => segment.duration)),
    integerRatios,
    coarseRatios,
    coarseBaseline: median(coarseRatios),
    roundedModeShares: segments.map((segment) =>
      calculateRoundedModeShare(segment.tsDurations, 2),
    ),
  };
}

function isShortEdgeAdCandidate(
  segment: ParsedDiscontinuitySegment,
  maxDuration: number,
) {
  return (
    segment.duration > 0 &&
    segment.duration < 150 &&
    segment.duration < maxDuration * 0.25
  );
}

function isShortMidrollAdCandidate(
  segments: ParsedDiscontinuitySegment[],
  index: number,
  maxDuration: number,
) {
  if (index <= 0 || index >= segments.length - 1) return false;

  const segment = segments[index];
  const prev = segments[index - 1];
  const next = segments[index + 1];
  if (!prev || !next) return false;

  // 中插广告通常表现为“很短的一段”夹在两段明显更长的正片之间。
  // 阈值放宽到 60s / 20%，覆盖 20-60s 的常见广告位（不少源站会插 30s 广告）。
  const isVeryShortMidroll =
    segment.duration > 0 &&
    segment.duration <= 60 &&
    segment.duration < maxDuration * 0.2;
  if (!isVeryShortMidroll) return false;

  const neighborThreshold = Math.max(segment.duration * 3, 90);
  return (
    prev.duration >= neighborThreshold && next.duration >= neighborThreshold
  );
}

function isTrailingShortAdBlockCandidate(
  segments: ParsedDiscontinuitySegment[],
  index: number,
  maxDuration: number,
) {
  if (index <= 0 || index >= segments.length) return false;

  const segment = segments[index];
  if (!isShortEdgeAdCandidate(segment, maxDuration)) return false;

  let firstTrailingIndex = segments.length;
  let trailingDuration = 0;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const current = segments[i];
    if (!isShortEdgeAdCandidate(current, maxDuration)) {
      break;
    }
    firstTrailingIndex = i;
    trailingDuration += current.duration;
  }

  if (index < firstTrailingIndex) return false;
  if (firstTrailingIndex === 0) return false;
  if (trailingDuration <= 0 || trailingDuration >= 150) return false;
  if (trailingDuration >= maxDuration * 0.25) return false;

  const previous = segments[firstTrailingIndex - 1];
  return previous.duration >= Math.max(120, maxDuration * 0.5);
}

function isCoarseFingerprintAdCandidate(
  segments: ParsedDiscontinuitySegment[],
  analysis: SegmentAnalysis,
  index: number,
) {
  if (segments.length < 4) return false;

  const segment = segments[index];
  if (segment.tsDurations.length < 4) return false;

  const coarseRatio = analysis.coarseRatios[index];
  if (coarseRatio < 0.85) return false;

  if (analysis.roundedModeShares[index] < 0.5) return false;
  if (analysis.integerRatios[index] < 0.45) return false;

  const baseline = analysis.coarseBaseline;
  if (baseline >= 0.35 && coarseRatio - baseline < 0.5) {
    return false;
  }

  return true;
}

function getSegmentAdReason(
  segments: ParsedDiscontinuitySegment[],
  analysis: SegmentAnalysis,
  index: number,
) {
  const segment = segments[index];
  if (segment.hasAdTag) return 'tag';
  if (segment.hasAdUri) return 'uri';
  if (isCoarseFingerprintAdCandidate(segments, analysis, index)) {
    return 'duration-grid';
  }
  if (isTrailingShortAdBlockCandidate(segments, index, analysis.maxDuration)) {
    return 'tail-short';
  }
  if (isShortMidrollAdCandidate(segments, index, analysis.maxDuration)) {
    return 'midroll-short';
  }
  if (isShortEdgeAdCandidate(segment, analysis.maxDuration)) {
    return 'edge-short';
  }
  return 'unknown';
}

function isAdSegment(
  segments: ParsedDiscontinuitySegment[],
  analysis: SegmentAnalysis,
  index: number,
): boolean {
  const segment = segments[index];

  // 强信号：广告标签或广告 URL，直接判定为广告。
  if (segment.hasAdTag || segment.hasAdUri) return true;

  // 量化步进指纹：覆盖 4.00 / 5.48 / 3.24 / 0.28 这类广告切片。
  if (isCoarseFingerprintAdCandidate(segments, analysis, index)) return true;

  // 首尾短区间沿用旧策略，优先清理片头片尾广告。
  const isEdge = index === 0 || index === segments.length - 1;
  if (isEdge && isShortEdgeAdCandidate(segment, analysis.maxDuration)) {
    return true;
  }

  if (isTrailingShortAdBlockCandidate(segments, index, analysis.maxDuration)) {
    return true;
  }

  // 补充中插广告场景：很多源站不会打广告标签，但会用一个很短的中间区间插播广告。
  return isShortMidrollAdCandidate(segments, index, analysis.maxDuration);
}

/**
 * 按 DISCONTINUITY 将 M3U8 行切分为多个区间，计算每个区间的总时长，
 * 识别广告区间并移除，只保留正片区间。
 *
 * 判定策略（保守）：
 * 1. 最长区间一定是正片，绝不删除
 * 2. 短区间（时长 < 最长区间的 25% 且 < 150s）标记为疑似广告
 * 3. 区间内片段 URL 命中广告关键词 → 强判定为广告
 * 4. 区间内存在 CUE-OUT / SCTE35 / OATCLS / SPLICEPOINT / ASSET / BREAK
 *    等广告标签 → 强判定为广告
 * 5. 无标签短区间默认只删除首尾；若中间区间不超过 60s 且 < 20% 最大时长、
 *    两侧明显更长，则视为中插广告一并删除
 * 6. 命中 40ms 粗粒度步进指纹（如 4.00 / 5.48 / 3.24 / 0.28），
 *    且显著偏离全局基线时，视为中插广告一并删除
 *
 * 返回过滤后的 M3U8 文本。如果无法识别任何广告区间，退化为仅删除
 * DISCONTINUITY 标签（与旧逻辑一致，保证不会比原来更差）。
 */
export function filterAdsFromM3U8(m3u8Content: string): string {
  if (!m3u8Content) return '';
  if (!m3u8Content.includes('#EXT-X-DISCONTINUITY')) return m3u8Content;

  const lines = m3u8Content.split('\n');
  const segments = parseDiscontinuitySegments(m3u8Content);

  // 只有 0 或 1 个区间，没有广告可删
  if (segments.length <= 1) return m3u8Content;

  // --- 第二步：识别广告区间 ---
  const analysis = analyzeSegments(segments);
  const adFlags = segments.map((_segment, index) =>
    isAdSegment(segments, analysis, index),
  );
  const hasAnyAd = adFlags.some(Boolean);

  // 没识别出任何广告 → 退化为旧逻辑（仅删 DISCONTINUITY 标签）
  if (!hasAnyAd) {
    return lines.filter((l) => l.trim() !== '#EXT-X-DISCONTINUITY').join('\n');
  }

  // --- 第三步：重组 M3U8，只保留非广告区间 ---
  const contentLines: string[] = [];
  let isFirst = true;

  for (let i = 0; i < segments.length; i++) {
    if (adFlags[i]) continue;

    if (isFirst) {
      isFirst = false;
    } else {
      // 非广告区间之间保留 DISCONTINUITY（正片本身可能有合法的不连续点）
      contentLines.push('#EXT-X-DISCONTINUITY');
    }
    for (const l of segments[i].lines) {
      contentLines.push(l);
    }
  }

  const hadEndList = lines.some((line) => line.trim() === '#EXT-X-ENDLIST');
  const hasEndList = contentLines.some(
    (line) => line.trim() === '#EXT-X-ENDLIST',
  );
  if (hadEndList && !hasEndList) {
    contentLines.push('#EXT-X-ENDLIST');
  }

  return contentLines.join('\n');
}

export function collectAdRangesFromM3U8(m3u8Content: string): AdRange[] {
  if (!m3u8Content || !m3u8Content.includes('#EXTINF')) return [];

  if (m3u8Content.includes('#EXT-X-DISCONTINUITY')) {
    const segments = parseDiscontinuitySegments(m3u8Content);
    if (!segments.length) return [];

    const analysis = analyzeSegments(segments);
    const ranges: AdRange[] = [];
    let timeline = 0;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const start = timeline;
      const end = timeline + segment.duration;

      if (segment.duration > 0 && isAdSegment(segments, analysis, i)) {
        ranges.push({
          start,
          end,
          reason: getSegmentAdReason(segments, analysis, i),
        });
      }

      timeline = end;
    }

    return mergeAdRanges(ranges);
  }

  const lines = m3u8Content.split('\n');
  const ranges: AdRange[] = [];
  let timeline = 0;
  let currentDuration = 0;
  let cueOutActive = false;
  let adTagMarked = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      currentDuration = parseExtinfDuration(line);
      continue;
    }

    if (line.startsWith('#')) {
      if (line.startsWith('#EXT-X-CUE-IN')) {
        cueOutActive = false;
        adTagMarked = false;
        continue;
      }

      if (line.startsWith('#EXT-X-CUE-OUT') || AD_TAG_RE.test(line)) {
        cueOutActive = true;
        adTagMarked = true;
      }
      continue;
    }

    const duration = currentDuration;
    const start = timeline;
    const end = timeline + duration;

    const byUriKeyword = isLikelyAdUri(line);
    const byTag = cueOutActive || adTagMarked;

    if (duration > 0 && (byUriKeyword || byTag)) {
      ranges.push({
        start,
        end,
        reason: byUriKeyword ? 'uri' : 'tag',
      });
    }

    timeline = end;
    currentDuration = 0;

    if (!cueOutActive) {
      adTagMarked = false;
    }
  }

  return mergeAdRanges(ranges);
}
