import type Artplayer from 'artplayer';
import type { MutableRefObject } from 'react';

import {
  readPreferredQualityHeight,
  writePreferredQualityHeight,
} from '@/lib/local-preferences';

interface HlsLevelLike {
  height?: number;
  bitrate?: number;
}

interface HlsQualityController {
  levels?: HlsLevelLike[];
  currentLevel: number;
  startLevel: number;
}

export interface QualityOption {
  levelIndex: number;
  height: number;
  label: string;
}

const QUALITY_CONTROL_NAME = 'icetv-quality';

export function formatQualityLabel(level: HlsLevelLike): string {
  const height = level.height || 0;
  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K';
  if (height > 0) return `${height}p`;
  const bitrate = level.bitrate || 0;
  return bitrate > 0 ? `${Math.round(bitrate / 1000)}kbps` : '默认';
}

export function buildQualityOptions(levels: HlsLevelLike[]): QualityOption[] {
  const sorted = levels
    .map((level, index) => ({
      levelIndex: index,
      height: level.height || 0,
      bitrate: level.bitrate || 0,
      label: formatQualityLabel(level),
    }))
    .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);

  const seenLabels = new Set<string>();
  const options: QualityOption[] = [];
  for (const option of sorted) {
    if (seenLabels.has(option.label)) {
      continue;
    }
    seenLabels.add(option.label);
    options.push({
      levelIndex: option.levelIndex,
      height: option.height,
      label: option.label,
    });
  }
  return options;
}

export function findPreferredLevelIndex(levels: HlsLevelLike[]): number | null {
  const preferredHeight = readPreferredQualityHeight();
  if (!preferredHeight || levels.length === 0) {
    return null;
  }

  let bestIndex = -1;
  let bestDelta = Number.POSITIVE_INFINITY;
  let bestBitrate = -1;
  levels.forEach((level, index) => {
    const delta = Math.abs((level.height || 0) - preferredHeight);
    const bitrate = level.bitrate || 0;
    if (delta < bestDelta || (delta === bestDelta && bitrate > bestBitrate)) {
      bestDelta = delta;
      bestIndex = index;
      bestBitrate = bitrate;
    }
  });
  return bestIndex >= 0 ? bestIndex : null;
}

interface QualityControlApi {
  update: (option: Record<string, unknown>) => void;
  remove: (name: string) => void;
}

interface QualitySelectorItem {
  html: string;
  default: boolean;
  levelIndex: number;
  height: number;
}

function registerQualityControl(
  art: Artplayer,
  hls: HlsQualityController,
  forceAuto = false,
): void {
  const levels = hls.levels || [];
  const controlApi = art.controls as unknown as QualityControlApi;

  if (levels.length < 2) {
    try {
      controlApi.remove(QUALITY_CONTROL_NAME);
    } catch {
      // 无同名控件
    }
    return;
  }

  const options = buildQualityOptions(levels);
  const preferredIndex = forceAuto ? null : findPreferredLevelIndex(levels);
  const activeOption =
    preferredIndex === null
      ? null
      : options.find((option) => option.levelIndex === preferredIndex) || null;

  const selector: QualitySelectorItem[] = [
    {
      html: '自动',
      default: !activeOption,
      levelIndex: -1,
      height: 0,
    },
    ...options.map((option) => ({
      html: option.label,
      default: activeOption?.levelIndex === option.levelIndex,
      levelIndex: option.levelIndex,
      height: option.height,
    })),
  ];

  const controlOption = {
    name: QUALITY_CONTROL_NAME,
    position: 'right',
    index: 10,
    style: { marginRight: '10px' },
    html: activeOption?.label || '自动',
    selector,
    onSelect(item: QualitySelectorItem) {
      if (item.levelIndex < 0) {
        writePreferredQualityHeight(null);
        hls.currentLevel = -1;
      } else {
        writePreferredQualityHeight(item.height);
        hls.currentLevel = item.levelIndex;
      }
      art.notice.show = `画质: ${item.html}`;
      return item.html;
    },
  };

  try {
    controlApi.update(controlOption);
  } catch (error) {
    console.warn('注册画质控件失败:', error);
  }
}

export function markQualityControlTemporaryAuto(
  artPlayerRef: MutableRefObject<Artplayer | null>,
  hls: HlsQualityController,
): void {
  const art = artPlayerRef.current;
  if (!art) {
    return;
  }
  registerQualityControl(art, hls, true);
}

export function registerQualityControlWhenReady(
  artPlayerRef: MutableRefObject<Artplayer | null>,
  hls: HlsQualityController,
  attempts = 10,
): void {
  const art = artPlayerRef.current;
  if (art) {
    registerQualityControl(art, hls);
    return;
  }
  if (attempts <= 0) {
    return;
  }
  setTimeout(() => {
    registerQualityControlWhenReady(artPlayerRef, hls, attempts - 1);
  }, 300);
}
