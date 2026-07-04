import {
  applyAutoQualityLevel,
  applyManualQualityLevel,
} from '@/features/play/lib/hlsQuality';

describe('hls quality level controls', () => {
  it('locks manual quality across HLS level selectors', () => {
    const hls = {
      levels: [{ height: 360 }, { height: 720 }, { height: 1080 }],
      startLevel: -1,
      currentLevel: -1,
      loadLevel: -1,
      nextLevel: -1,
      nextLoadLevel: -1,
      autoLevelCapping: -1,
      __icetvManualQualityLocked: false,
    };

    applyManualQualityLevel(hls, 1, { userSelected: true });

    expect(hls).toMatchObject({
      startLevel: 1,
      currentLevel: 1,
      loadLevel: 1,
      nextLevel: 1,
      nextLoadLevel: 1,
      autoLevelCapping: -1,
      __icetvManualQualityLocked: true,
    });
  });

  it('clears manual quality locks for auto mode', () => {
    const hls = {
      levels: [{ height: 360 }, { height: 720 }],
      startLevel: 1,
      currentLevel: 1,
      loadLevel: 1,
      nextLevel: 1,
      nextLoadLevel: 1,
      autoLevelCapping: -1,
      __icetvManualQualityLocked: true,
    };

    applyAutoQualityLevel(hls);

    expect(hls).toMatchObject({
      startLevel: -1,
      currentLevel: -1,
      loadLevel: -1,
      nextLevel: -1,
      nextLoadLevel: -1,
      autoLevelCapping: -1,
      __icetvManualQualityLocked: false,
    });
  });
});
