export interface DiscontSegment {
  lineIndices: number[];
  tsPaths: string[];
  tsDurations: number[];
  duration: number;
}

function createDiscontSegment(): DiscontSegment {
  return {
    lineIndices: [],
    tsPaths: [],
    tsDurations: [],
    duration: 0,
  };
}

export function parseDiscontinuitySegments(m3u8Content: string): {
  lines: string[];
  segments: DiscontSegment[];
} {
  const lines = m3u8Content.split('\n');
  const segments: DiscontSegment[] = [];
  let current = createDiscontSegment();
  let pendingDuration = 0;
  let pendingExtinfIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (line === '#EXT-X-DISCONTINUITY') {
      if (current.tsPaths.length > 0) {
        segments.push(current);
      }
      current = createDiscontSegment();
      pendingDuration = 0;
      pendingExtinfIndex = -1;
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const rawDuration = line.slice(8).split(',')[0]?.trim() || '';
      pendingDuration = Number.parseFloat(rawDuration) || 0;
      pendingExtinfIndex = index;
      continue;
    }

    if (line && !line.startsWith('#')) {
      if (pendingExtinfIndex >= 0) {
        current.lineIndices.push(pendingExtinfIndex);
      }
      current.lineIndices.push(index);
      current.tsPaths.push(line);
      current.tsDurations.push(pendingDuration);
      current.duration += pendingDuration;
      pendingDuration = 0;
      pendingExtinfIndex = -1;
    }
  }

  if (current.tsPaths.length > 0) {
    segments.push(current);
  }

  return { lines, segments };
}

function collectDroppedMediaLines(
  segments: DiscontSegment[],
  adIndices: Set<number>,
): Set<number> {
  const dropLines = new Set<number>();
  adIndices.forEach((index) => {
    for (const lineIndex of segments[index].lineIndices) {
      dropLines.add(lineIndex);
    }
  });
  return dropLines;
}

export function removeAdSegmentsKeepingDiscontinuities(
  lines: string[],
  segments: DiscontSegment[],
  adIndices: Set<number>,
): string {
  if (adIndices.size === 0) return lines.join('\n');

  const dropLines = collectDroppedMediaLines(segments, adIndices);
  const output: string[] = [];
  let lastWasDiscontinuity = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (dropLines.has(index)) continue;

    const line = lines[index];
    const normalized = line.trim();
    if (normalized === '#EXT-X-DISCONTINUITY') {
      if (lastWasDiscontinuity) continue;
      lastWasDiscontinuity = true;
    } else if (normalized !== '') {
      lastWasDiscontinuity = false;
    }
    output.push(line);
  }

  return output.join('\n');
}

export function rebuildContinuousPlaylist(
  lines: string[],
  segments: DiscontSegment[],
  adIndices: Set<number>,
): string {
  const dropLines = collectDroppedMediaLines(segments, adIndices);
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (dropLines.has(index)) continue;

    const line = lines[index];
    if (line.trim() === '#EXT-X-DISCONTINUITY') continue;
    output.push(line);
  }

  return output.join('\n');
}
