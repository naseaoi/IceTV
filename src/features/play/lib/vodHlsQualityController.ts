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

export type VodHlsQualityController = {
  dispose: () => void;
  handleBufferUpdated: () => void;
  handleFragmentLoaded: () => void;
  handleFragmentLoading: (levelIndex: number | null) => void;
  handleManifestParsed: () => void;
  isActive: () => boolean;
  tryRecoverFatalNetworkFailure: (input: {
    isFragmentNetworkError: boolean;
    isFragmentOrLevelNetworkError: boolean;
  }) => boolean;
  tryRecoverManualSelectionFailure: (
    isFragmentOrLevelNetworkError: boolean,
  ) => boolean;
};

const MANUAL_QUALITY_FAILURE_LIMIT = 2;
const DEFAULT_QUALITY_PROBE_MS = 10_000;

function getCurrentHlsLevelIndex(hls: VodQualityHls): number | null {
  const candidates = [hls.currentLevel, hls.loadLevel, hls.nextLoadLevel];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && candidate >= 0) {
      return candidate;
    }
  }
  return null;
}

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
    const levels = hls.levels || [];
    active = !!policy && buildQualityOptions(levels).length >= 2;
    if (!active || !policy) {
      controlOptions = null;
      applyAutoQualityLevel(hls);
      hls.__icetvDefaultQualityLevel = null;
      controlSyncCleanup = removeQualityControlWhenReady(artPlayerRef);
      return;
    }

    const defaultLevelIndex = findLevelIndexByHeight(
      levels,
      policy.defaultHeight,
    );
    const autoStartLevelIndex = findLevelIndexByHeight(
      levels,
      policy.autoStartHeight,
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
        writeSourcePreferredQualityHeight(sourceKey, height);
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

  const handleFragmentLoaded = () => {
    clearQualityProbe();
    if (hls.__icetvManualQualityLocked === true) {
      manualQualityNetworkFailures = 0;
    }
  };

  const handleBufferUpdated = () => {
    if (
      !active ||
      !policy?.recoveryBufferSeconds ||
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
      !policy?.emergencyBufferSeconds ||
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
      policy?.preserveManualSelectionOnFailure === true ||
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

  const tryRecoverFatalNetworkFailure = ({
    isFragmentNetworkError,
    isFragmentOrLevelNetworkError,
  }: {
    isFragmentNetworkError: boolean;
    isFragmentOrLevelNetworkError: boolean;
  }) => {
    if (!active || !policy || !controlOptions) {
      return false;
    }

    if (
      isFragmentNetworkError &&
      policy.allowFailureDowngrade &&
      hls.__icetvManualQualityLocked !== true
    ) {
      const currentLevel = getCurrentHlsLevelIndex(hls);
      const nextLowerLevel =
        currentLevel === null
          ? null
          : findNextLowerLevelIndex(hls.levels || [], currentLevel);
      const nextLevel =
        nextLowerLevel === null || currentLevel === null
          ? null
          : Math.max(nextLowerLevel, autoMinLevelIndex ?? nextLowerLevel);
      if (
        currentLevel !== null &&
        nextLevel !== null &&
        nextLevel < currentLevel
      ) {
        applyAutoQualityLevel(hls, {
          startLevelIndex: nextLevel,
          minLevelIndex: autoMinLevelIndex,
          maxLevelIndex: controlOptions.autoMaxLevelIndex,
        });
        markQualityControlTemporaryAuto(artPlayerRef, hls, controlOptions);
        hls.startLoad();
        const level = hls.levels?.[nextLevel];
        const label = level?.height ? `${level.height}p` : '较低画质';
        showNotice(`当前画质分片加载失败，已切换到${label}`);
        return true;
      }
    }

    if (
      isFragmentOrLevelNetworkError &&
      hls.autoLevelEnabled === false &&
      hls.__icetvManualQualityLocked !== true
    ) {
      clearQualityProbe();
      return releaseToAuto();
    }
    return false;
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
    tryRecoverFatalNetworkFailure,
    tryRecoverManualSelectionFailure,
  };
}
