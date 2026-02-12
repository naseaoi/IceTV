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

export const AD_KEYWORD_RE =
  /(^|[\/_.?=&-])(ad|ads|adbreak|advert|commercial|promo|preroll|midroll)($|[\/_.?=&-])/i;
export const AD_TAG_RE =
  /#EXT-X-CUE-OUT|#EXT-X-DATERANGE|SCTE35|X-ASSET-LIST|CLASS="ad"|CLASS=ad/i;

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

    const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
    if (!match) return 30;

    const value = parseFloat(match[1]);
    const unit = match[2];
    const speedKBps = unit === 'MB/s' ? value * 1024 : value;
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

export function collectAdRangesFromM3U8(m3u8Content: string): AdRange[] {
  if (!m3u8Content || !m3u8Content.includes('#EXTINF')) return [];

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
