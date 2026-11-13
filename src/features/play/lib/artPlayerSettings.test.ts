import type Artplayer from 'artplayer';

import { createArtPlayerSettings } from '@/features/play/lib/artPlayerSettings';
import {
  writeAutoPlayNextEnabled,
  writeBlockAdEnabled,
} from '@/lib/local-preferences';
import { runManagedVideoCleanup } from '@/lib/player-runtime';
import { showToast } from '@/lib/toast';

jest.mock('@/lib/local-preferences', () => ({
  writeAutoPlayNextEnabled: jest.fn(),
  writeBlockAdEnabled: jest.fn(),
}));
jest.mock('@/lib/player-runtime', () => ({
  destroyManagedHls: jest.fn(),
  runManagedVideoCleanup: jest.fn(),
}));
jest.mock('@/lib/player-utils', () => ({
  destroyArtPlayer: jest.fn(),
  formatTime: jest.fn(),
}));
jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));
it('去广告重建失败恢复原开关与偏好并提示', () => {
  jest.mocked(writeBlockAdEnabled).mockReturnValue(true);
  jest.mocked(runManagedVideoCleanup).mockImplementation(() => {
    throw new Error('internal');
  });
  const setBlockAdEnabled = jest.fn();
  const settings = createArtPlayerSettings({
    artPlayerRef: { current: { currentTime: 10, video: {} } as Artplayer },
    blockAdEnabled: true,
    autoPlayNextEnabled: true,
    autoPlayNextEnabledRef: { current: true },
    skipConfigRef: { current: { enable: false, intro_time: 0, outro_time: 0 } },
    resumeTimeRef: { current: null },
    resumeModeRef: { current: 'forced' },
    stableCurrentTimeRef: { current: 0 },
    clearTargetEpisodeProgressRef: { current: false },
    setBlockAdEnabled,
    setAutoPlayNextEnabled: jest.fn(),
    handleSkipConfigChange: jest.fn(),
  });
  expect(settings[0].onSwitch?.({ switch: true })).toBe(true);
  expect(setBlockAdEnabled).toHaveBeenCalledWith(true);
  expect(writeBlockAdEnabled).toHaveBeenLastCalledWith(true);
  expect(showToast).toHaveBeenCalledWith('去广告设置未能生效，请重试', 'error');
  expect(writeAutoPlayNextEnabled).not.toHaveBeenCalled();
});

describe('去广告重建播放器的续播点', () => {
  function toggleBlockAd({
    playerCurrentTime,
    pendingResumeTime,
    targetEpisodePending,
  }: {
    playerCurrentTime: number;
    pendingResumeTime: number | null;
    targetEpisodePending: boolean;
  }) {
    jest.mocked(writeBlockAdEnabled).mockReturnValue(true);
    jest.mocked(runManagedVideoCleanup).mockImplementation(() => undefined);
    const resumeTimeRef = { current: pendingResumeTime };
    const resumeModeRef = {
      current: (pendingResumeTime === null ? null : 'history') as
        | 'history'
        | 'forced'
        | null,
    };
    const settings = createArtPlayerSettings({
      artPlayerRef: {
        current: { currentTime: playerCurrentTime, video: {} } as Artplayer,
      },
      blockAdEnabled: true,
      autoPlayNextEnabled: true,
      autoPlayNextEnabledRef: { current: true },
      skipConfigRef: {
        current: { enable: false, intro_time: 0, outro_time: 0 },
      },
      resumeTimeRef,
      resumeModeRef,
      stableCurrentTimeRef: { current: 0 },
      clearTargetEpisodeProgressRef: { current: targetEpisodePending },
      setBlockAdEnabled: jest.fn(),
      setAutoPlayNextEnabled: jest.fn(),
      handleSkipConfigChange: jest.fn(),
    });
    settings[0].onSwitch?.({ switch: true });
    return { resumeTime: resumeTimeRef.current, mode: resumeModeRef.current };
  }

  it('起播前沿用待恢复的历史进度，不取播放器上的 0 秒', () => {
    expect(
      toggleBlockAd({
        playerCurrentTime: 0,
        pendingResumeTime: 844,
        targetEpisodePending: true,
      }),
    ).toEqual({ resumeTime: 844, mode: 'forced' });
  });

  it('目标集未起播时不取上一集留在播放器上的时间', () => {
    expect(
      toggleBlockAd({
        playerCurrentTime: 900,
        pendingResumeTime: 0,
        targetEpisodePending: true,
      }),
    ).toEqual({ resumeTime: 0, mode: 'history' });
  });

  it('已起播时按播放器当前时间续播', () => {
    expect(
      toggleBlockAd({
        playerCurrentTime: 125,
        pendingResumeTime: null,
        targetEpisodePending: false,
      }),
    ).toEqual({ resumeTime: 125, mode: 'forced' });
  });
});
