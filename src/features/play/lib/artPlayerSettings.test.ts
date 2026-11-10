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
