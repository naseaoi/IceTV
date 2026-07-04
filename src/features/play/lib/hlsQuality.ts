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

const QUALITY_SETTING_NAME = 'icetv-quality';
const QUALITY_ICON =
  '<text x="50%" y="50%" font-size="18" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">HD</text>';

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

function registerQualitySetting(
  art: Artplayer,
  hls: HlsQualityController,
): void {
  const levels = hls.levels || [];
  const settingApi = art.setting as unknown as {
    add: (option: Record<string, unknown>) => void;
    update: (option: Record<string, unknown>) => void;
    remove: (name: string) => void;
  };

  if (levels.length < 2) {
    try {
      settingApi.remove(QUALITY_SETTING_NAME);
    } catch {
      // 无同名设置项
    }
    return;
  }

  const options = buildQualityOptions(levels);
  const preferredIndex = findPreferredLevelIndex(levels);
  const activeOption =
    preferredIndex === null
      ? null
      : options.find((option) => option.levelIndex === preferredIndex) || null;

  const selector = [
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

  const settingOption = {
    name: QUALITY_SETTING_NAME,
    html: '画质',
    icon: QUALITY_ICON,
    width: 200,
    tooltip: activeOption?.label || '自动',
    selector,
    onSelect(item: { html: string; levelIndex: number; height: number }) {
      if (item.levelIndex < 0) {
        writePreferredQualityHeight(null);
        hls.currentLevel = -1;
      } else {
        writePreferredQualityHeight(item.height);
        hls.currentLevel = item.levelIndex;
      }
      return item.html;
    },
  };

  try {
    settingApi.update(settingOption);
  } catch (error) {
    console.warn('注册画质设置失败:', error);
  }
}

export function registerQualitySettingWhenReady(
  artPlayerRef: MutableRefObject<Artplayer | null>,
  hls: HlsQualityController,
  attempts = 10,
): void {
  const art = artPlayerRef.current;
  if (art) {
    registerQualitySetting(art, hls);
    return;
  }
  if (attempts <= 0) {
    return;
  }
  setTimeout(() => {
    registerQualitySettingWhenReady(artPlayerRef, hls, attempts - 1);
  }, 300);
}
