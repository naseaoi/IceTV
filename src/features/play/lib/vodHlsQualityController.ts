import type Artplayer from 'artplayer';
import type { MutableRefObject } from 'react';

import {
  type HlsQualityController,
  type HlsQualityControlOptions,
  applyAutoQualityLevel,
  applyDefaultQualityLevel,
  applyManualQualityLevel,
  buildQualityOptions,
  findLevelIndexByHeight,
  findNextLowerLevelIndex,
  markQualityControlTemporaryAuto,
  registerQualityControlWhenReady,
  removeQualityControlWhenReady,
  seedAutoQualityStartLevel,
  setAutoQualityMinLevel,
} from '@/features/play/lib/hlsQuality';
import {
  type BufferedVideoLike,
  getForwardBufferSeconds,
} from '@/features/play/lib/vodBufferPriority';
import { resolveVodQualityPolicy } from '@/features/play/lib/vodQualityPolicy';
import {
  readSourcePreferredQualityPreference,
  writeSourcePreferredQualityHeight,
} from '@/lib/local-preferences';
import { showTimedArtNotice } from '@/lib/player-utils';
import { showToast } from '@/lib/toast';

type VodQualityHls = HlsQualityController & {
  autoLevelEnabled?: boolean;
  startLoad: () => void;
};

type VodHlsQualityControllerOptions = {
  sourceKey: string;
  hls: VodQualityHls;
  video: BufferedVideoLike;
  artPlayerRef: MutableRefObject<Artplayer | null>;
  setRealtimeLoadSpeed: (message: string) => void;
};

type HlsFragmentLike = { type?: string; level?: number } | null | undefined;

export type HlsLevelFailure = {
  details?: string;
  fatal?: boolean;
  level?: number;
  context?: { type?: string; level?: number | null } | null;
  frag?: HlsFragmentLike;
};

export type VodHlsQualityController = {
  dispose: () => void;
  handleBufferUpdated: () => void;
  handleFragmentLoaded: (frag?: HlsFragmentLike) => void;
  handleFragmentLoading: (levelIndex: number | null) => void;
  handleManifestParsed: () => void;
  isActive: () => boolean;
  tryDowngradeFailedLevel: (
    failure: HlsLevelFailure,
    options: { requireOtherLevelLoaded: boolean },
  ) => boolean;
  tryRecoverFatalNetworkFailure: (
    isFragmentOrLevelNetworkError: boolean,
  ) => boolean;
  tryRecoverManualSelectionFailure: (
    isFragmentOrLevelNetworkError: boolean,
  ) => boolean;
};

const MANUAL_QUALITY_FAILURE_LIMIT = 2;
const DEFAULT_QUALITY_PROBE_MS = 10_000;

function resolveFailedLevelIndex(
  failure: HlsLevelFailure,
  levelCount: number,
): number | null {
  const level = /^level/i.test(failure.details || '')
    ? failure.context?.type === 'level'
      ? failure.context.level
      : failure.level
    : failure.frag?.type === 'main'
      ? failure.frag.level
      : null;
  return typeof level === 'number' &&
    Number.isInteger(level) &&
    level >= 0 &&
    level < levelCount
    ? level
    : null;
}

const minLevelIndex = (current: number | null, cap: number) =>
  current === null ? null : Math.min(current, cap);

export function createVodHlsQualityController({
  sourceKey,
  hls,
  video,
  artPlayerRef,
  setRealtimeLoadSpeed,
}: VodHlsQualityControllerOptions): VodHlsQualityController {
  const policy = resolveVodQualityPolicy(sourceKey);
  let active = false;
  let manualQualityNetworkFailures = 0;
  let qualityProbeTimer: ReturnType<typeof setTimeout> | null = null;
  let controlOptions: HlsQualityControlOptions | null = null;
  let controlSyncCleanup: (() => void) | null = null;
  let autoMinLevelIndex: number | null = null;
  let autoPreferredLevelIndex: number | null = null;
  let autoEmergencyMode = false;
  // 本次清单内主媒体分片加载成功过的档位；换线路会重新解析清单，因此天然按线路隔离
  const loadedLevelIndexes = new Set<number>();

  const clearQualityProbe = () => {
    if (!qualityProbeTimer) {
      return;
    }
    clearTimeout(qualityProbeTimer);
    qualityProbeTimer = null;
  };

  const showNotice = (message: string) => {
    setRealtimeLoadSpeed(message);
    const art = artPlayerRef.current;
    if (art) {
      showTimedArtNotice(art, message);
    }
  };

  const clearControlSync = () => {
    controlSyncCleanup?.();
    controlSyncCleanup = null;
  };

  const applyPreferredAutoFloor = (forceNextLevel: boolean) => {
    if (autoPreferredLevelIndex === null) {
      return;
    }
    autoEmergencyMode = false;
    setAutoQualityMinLevel(hls, autoPreferredLevelIndex);
    if (forceNextLevel) {
      hls.nextLoadLevel = autoPreferredLevelIndex;
      hls.nextAutoLevel = autoPreferredLevelIndex;
    }
  };

  const applyEmergencyAutoFloor = () => {
    if (autoMinLevelIndex === null || autoEmergencyMode) {
      return;
    }
    autoEmergencyMode = true;
    setAutoQualityMinLevel(hls, autoMinLevelIndex);
  };

  const releaseToAuto = (message = '所选画质加载失败，已临时切回自动') => {
    if (!active || !controlOptions) {
      return false;
    }
    applyAutoQualityLevel(hls, {
      startLevelIndex: controlOptions.autoStartLevelIndex,
      minLevelIndex: controlOptions.autoInitialMinLevelIndex,
      maxLevelIndex: controlOptions.autoMaxLevelIndex,
    });
    hls.startLoad();
    markQualityControlTemporaryAuto(artPlayerRef, hls, controlOptions);
    showNotice(message);
    return true;
  };

  const handleManifestParsed = () => {
    clearQualityProbe();
    clearControlSync();
    manualQualityNetworkFailures = 0;
    loadedLevelIndexes.clear();
    autoEmergencyMode = false;
    const levels = hls.levels || [];
    active = buildQualityOptions(levels).length >= 2;
    if (!active) {
      controlOptions = null;
      applyAutoQualityLevel(hls);
      hls.__icetvDefaultQualityLevel = null;
      controlSyncCleanup = removeQualityControlWhenReady(artPlayerRef);
      return;
    }

    const defaultLevelIndex = findLevelIndexByHeight(
      levels,
      policy.defaultHeight ?? 0,
    );
    const autoStartLevelIndex = findLevelIndexByHeight(
      levels,
      policy.autoStartHeight ?? 0,
    );
    autoMinLevelIndex = policy.autoMinHeight
      ? findLevelIndexByHeight(levels, policy.autoMinHeight)
      : null;
    autoPreferredLevelIndex = autoStartLevelIndex;
    const autoMaxLevelIndex = policy.autoMaxHeight
      ? findLevelIndexByHeight(levels, policy.autoMaxHeight)
      : null;
    const preference = readSourcePreferredQualityPreference(sourceKey);
    controlOptions = {
      preference,
      defaultLevelIndex,
      autoStartLevelIndex,
      autoInitialMinLevelIndex: autoPreferredLevelIndex,
      autoMaxLevelIndex,
      onPreferenceChange: (height) => {
        if (!writeSourcePreferredQualityHeight(sourceKey, height))
          showToast('设置未能保存，刷新后会恢复', 'error', {
            key: 'local-preference-save',
          });
        if (!controlOptions) {
          return;
        }
        controlOptions.preference = height
          ? { mode: 'manual', height }
          : { mode: 'auto' };
        if (height === null) {
          applyPreferredAutoFloor(false);
        }
      },
    };
    hls.__icetvDefaultQualityLevel = defaultLevelIndex;

    const preferredLevelIndex =
      preference.mode === 'manual'
        ? findLevelIndexByHeight(levels, preference.height)
        : preference.mode === 'default'
          ? defaultLevelIndex
          : null;
    if (preferredLevelIndex !== null && preference.mode !== 'auto') {
      if (preference.mode === 'manual') {
        applyManualQualityLevel(hls, preferredLevelIndex, {
          userSelected: true,
        });
      } else {
        applyDefaultQualityLevel(hls, preferredLevelIndex);
      }
      qualityProbeTimer = setTimeout(() => {
        qualityProbeTimer = null;
        if (
          hls.autoLevelEnabled === false &&
          hls.__icetvManualQualityLocked !== true
        ) {
          releaseToAuto();
        }
      }, DEFAULT_QUALITY_PROBE_MS);
    } else {
      // 复用的 hls 实例可能带着上一个源的档位限制
      applyAutoQualityLevel(hls);
      seedAutoQualityStartLevel(
        hls,
        autoStartLevelIndex,
        autoPreferredLevelIndex,
        autoMaxLevelIndex,
      );
    }
    controlSyncCleanup = registerQualityControlWhenReady(
      artPlayerRef,
      hls,
      controlOptions,
    );
  };

  const handleFragmentLoaded = (frag?: HlsFragmentLike) => {
    if (
      frag?.type === 'main' &&
      typeof frag.level === 'number' &&
      frag.level >= 0
    ) {
      loadedLevelIndexes.add(frag.level);
    }
    clearQualityProbe();
    if (hls.__icetvManualQualityLocked === true) {
      manualQualityNetworkFailures = 0;
    }
  };

  const handleBufferUpdated = () => {
    if (
      !active ||
      !policy.recoveryBufferSeconds ||
      hls.__icetvManualQualityLocked === true ||
      hls.autoLevelEnabled === false ||
      !autoEmergencyMode
    ) {
      return;
    }
    if (getForwardBufferSeconds(video) >= policy.recoveryBufferSeconds) {
      applyPreferredAutoFloor(true);
    }
  };

  const handleFragmentLoading = (levelIndex: number | null) => {
    if (
      !active ||
      !policy.emergencyBufferSeconds ||
      hls.__icetvManualQualityLocked === true ||
      hls.autoLevelEnabled === false ||
      levelIndex === null ||
      autoPreferredLevelIndex === null
    ) {
      return;
    }
    if (!autoEmergencyMode && levelIndex < autoPreferredLevelIndex) {
      hls.nextLoadLevel = autoPreferredLevelIndex;
      hls.nextAutoLevel = autoPreferredLevelIndex;
      return;
    }
    if (levelIndex < autoPreferredLevelIndex) {
      return;
    }
    if (getForwardBufferSeconds(video) < policy.emergencyBufferSeconds) {
      applyEmergencyAutoFloor();
    }
  };

  const tryRecoverManualSelectionFailure = (
    isFragmentOrLevelNetworkError: boolean,
  ) => {
    if (
      !active ||
      !isFragmentOrLevelNetworkError ||
      policy.preserveManualSelectionOnFailure === true ||
      hls.autoLevelEnabled !== false ||
      hls.__icetvManualQualityLocked !== true
    ) {
      return false;
    }
    manualQualityNetworkFailures += 1;
    if (manualQualityNetworkFailures < MANUAL_QUALITY_FAILURE_LIMIT) {
      return false;
    }
    manualQualityNetworkFailures = 0;
    clearQualityProbe();
    return releaseToAuto('所选画质连续加载失败，已临时切回自动');
  };

  // 降到失败档以下并把自动码率上限压在目标档，避免 ABR 又升回坏档；限制随下一次清单解析解除
  const tryDowngradeFailedLevel = (
    failure: HlsLevelFailure,
    { requireOtherLevelLoaded }: { requireOtherLevelLoaded: boolean },
  ) => {
    if (
      !active ||
      !controlOptions ||
      !policy.allowFailureDowngrade ||
      hls.__icetvManualQualityLocked === true
    ) {
      return false;
    }
    const levels = hls.levels || [];
    const failedLevel = resolveFailedLevelIndex(failure, levels.length);
    if (failedLevel === null) {
      return false;
    }
    if (
      requireOtherLevelLoaded &&
      ![...loadedLevelIndexes].some((level) => level !== failedLevel)
    ) {
      return false;
    }
    const nextLowerLevel = findNextLowerLevelIndex(levels, failedLevel);
    if (nextLowerLevel === null) {
      return false;
    }
    const targetLevel = Math.max(
      nextLowerLevel,
      autoMinLevelIndex ?? nextLowerLevel,
    );
    if (targetLevel >= failedLevel) {
      return false;
    }

    clearQualityProbe();
    autoEmergencyMode = false;
    autoMinLevelIndex = minLevelIndex(autoMinLevelIndex, targetLevel);
    autoPreferredLevelIndex = minLevelIndex(
      autoPreferredLevelIndex,
      targetLevel,
    );
    controlOptions.autoStartLevelIndex = minLevelIndex(
      controlOptions.autoStartLevelIndex,
      targetLevel,
    );
    controlOptions.autoInitialMinLevelIndex = autoPreferredLevelIndex;
    controlOptions.autoMaxLevelIndex =
      minLevelIndex(controlOptions.autoMaxLevelIndex, targetLevel) ??
      targetLevel;
    applyAutoQualityLevel(hls, {
      startLevelIndex: targetLevel,
      minLevelIndex: autoMinLevelIndex,
      maxLevelIndex: targetLevel,
    });
    hls.nextLoadLevel = targetLevel;
    // 致命错误后 hls.js 已停止加载；非致命时它仍在加载，startLoad 会中止在途请求
    if (failure.fatal) {
      hls.startLoad();
    }
    markQualityControlTemporaryAuto(artPlayerRef, hls, controlOptions);
    const level = levels[targetLevel];
    const label = level?.height ? `${level.height}p` : '较低画质';
    showNotice(`当前画质加载失败，已切换到${label}`);
    return true;
  };

  const tryRecoverFatalNetworkFailure = (
    isFragmentOrLevelNetworkError: boolean,
  ) => {
    if (
      !active ||
      !isFragmentOrLevelNetworkError ||
      hls.autoLevelEnabled !== false ||
      hls.__icetvManualQualityLocked === true
    ) {
      return false;
    }
    clearQualityProbe();
    return releaseToAuto();
  };

  return {
    dispose: () => {
      clearQualityProbe();
      clearControlSync();
      removeQualityControlWhenReady(artPlayerRef, 0)();
    },
    handleBufferUpdated,
    handleFragmentLoaded,
    handleFragmentLoading,
    handleManifestParsed,
    isActive: () => active,
    tryDowngradeFailedLevel,
    tryRecoverFatalNetworkFailure,
    tryRecoverManualSelectionFailure,
  };
}
