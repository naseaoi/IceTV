import type Artplayer from 'artplayer';
import type { MutableRefObject } from 'react';

import {
  readPreferredQualityHeight,
  readPreferredQualityPreference,
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
  loadLevel?: number;
  nextLevel?: number;
  nextLoadLevel?: number;
  nextAutoLevel?: number;
  autoLevelCapping?: number;
  __icetvManualQualityLocked?: boolean;
  __icetvDefaultQualityLevel?: number | null;
}

export interface QualityOption {
  levelIndex: number;
  height: number;
  label: string;
}

const QUALITY_CONTROL_NAME = 'icetv-quality';

function trySetHlsQualityValue<K extends keyof HlsQualityController>(
  hls: HlsQualityController,
  key: K,
  value: HlsQualityController[K],
): void {
  try {
    hls[key] = value;
  } catch {}
}

function normalizeLevelIndex(
  levels: HlsLevelLike[] | undefined,
  levelIndex: number | null | undefined,
): number | null {
  if (levelIndex === null || levelIndex === undefined || levelIndex < 0) {
    return null;
  }
  if (!levels?.length) {
    return levelIndex;
  }
  return Math.min(levels.length - 1, Math.floor(levelIndex));
}

export function findHighestLevelIndex(levels: HlsLevelLike[]): number | null {
  if (levels.length === 0) {
    return null;
  }

  let bestIndex = 0;
  let bestHeight = levels[0]?.height || 0;
  let bestBitrate = levels[0]?.bitrate || 0;
  levels.forEach((level, index) => {
    const height = level.height || 0;
    const bitrate = level.bitrate || 0;
    if (
      height > bestHeight ||
      (height === bestHeight && bitrate > bestBitrate)
    ) {
      bestIndex = index;
      bestHeight = height;
      bestBitrate = bitrate;
    }
  });
  return bestIndex;
}

export function findNextLowerLevelIndex(
  levels: HlsLevelLike[],
  currentLevelIndex: number,
): number | null {
  const currentLevel = levels[currentLevelIndex];
  if (!currentLevel || levels.length === 0) {
    return null;
  }

  const currentHeight = currentLevel.height || 0;
  const currentBitrate = currentLevel.bitrate || 0;
  let bestIndex = -1;
  let bestHeight = -1;
  let bestBitrate = -1;

  levels.forEach((level, index) => {
    if (index === currentLevelIndex) {
      return;
    }

    const height = level.height || 0;
    const bitrate = level.bitrate || 0;
    const lowerByHeight = currentHeight > 0 && height < currentHeight;
    const lowerByBitrate =
      currentHeight <= 0 && currentBitrate > 0 && bitrate < currentBitrate;

    if (!lowerByHeight && !lowerByBitrate) {
      return;
    }

    if (
      height > bestHeight ||
      (height === bestHeight && bitrate > bestBitrate)
    ) {
      bestIndex = index;
      bestHeight = height;
      bestBitrate = bitrate;
    }
  });

  return bestIndex >= 0 ? bestIndex : null;
}

export function applyAutoQualityLevel(
  hls: HlsQualityController,
  options: { startLevelIndex?: number | null } = {},
): void {
  const startLevelIndex = normalizeLevelIndex(
    hls.levels,
    options.startLevelIndex,
  );
  hls.__icetvManualQualityLocked = false;
  trySetHlsQualityValue(hls, 'startLevel', startLevelIndex ?? -1);
  trySetHlsQualityValue(hls, 'currentLevel', -1);
  trySetHlsQualityValue(hls, 'loadLevel', -1);
  trySetHlsQualityValue(hls, 'nextLevel', -1);
  trySetHlsQualityValue(hls, 'nextLoadLevel', -1);
  if (startLevelIndex !== null) {
    trySetHlsQualityValue(hls, 'nextAutoLevel', startLevelIndex);
  }
  trySetHlsQualityValue(hls, 'autoLevelCapping', -1);
}

export function seedAutoQualityStartLevel(
  hls: HlsQualityController,
  startLevelIndex: number | null,
): void {
  const normalizedLevelIndex = normalizeLevelIndex(hls.levels, startLevelIndex);
  if (normalizedLevelIndex === null) {
    return;
  }
  hls.__icetvManualQualityLocked = false;
  trySetHlsQualityValue(hls, 'startLevel', normalizedLevelIndex);
  trySetHlsQualityValue(hls, 'nextAutoLevel', normalizedLevelIndex);
  trySetHlsQualityValue(hls, 'autoLevelCapping', -1);
}

export function applyManualQualityLevel(
  hls: HlsQualityController,
  levelIndex: number,
  options: { userSelected?: boolean } = {},
): void {
  hls.__icetvManualQualityLocked = options.userSelected === true;
  trySetHlsQualityValue(hls, 'startLevel', levelIndex);
  trySetHlsQualityValue(hls, 'currentLevel', levelIndex);
  trySetHlsQualityValue(hls, 'loadLevel', levelIndex);
  trySetHlsQualityValue(hls, 'nextLevel', levelIndex);
  trySetHlsQualityValue(hls, 'nextLoadLevel', levelIndex);
  trySetHlsQualityValue(hls, 'autoLevelCapping', -1);
}

export function applyDefaultQualityLevel(
  hls: HlsQualityController,
  levelIndex: number,
): void {
  hls.__icetvManualQualityLocked = false;
  trySetHlsQualityValue(hls, 'currentLevel', levelIndex);
  trySetHlsQualityValue(hls, 'autoLevelCapping', -1);
}

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

export function findLevelIndexByHeight(
  levels: HlsLevelLike[],
  preferredHeight: number,
): number | null {
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
  const qualityPreference = readPreferredQualityPreference();
  const preferredIndex = forceAuto
    ? null
    : qualityPreference.mode === 'manual'
      ? findLevelIndexByHeight(levels, qualityPreference.height)
      : qualityPreference.mode === 'default'
        ? (hls.__icetvDefaultQualityLevel ?? findHighestLevelIndex(levels))
        : null;
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
        applyAutoQualityLevel(hls, {
          startLevelIndex:
            hls.__icetvDefaultQualityLevel ?? findHighestLevelIndex(levels),
        });
      } else {
        writePreferredQualityHeight(item.height);
        applyManualQualityLevel(hls, item.levelIndex, { userSelected: true });
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
