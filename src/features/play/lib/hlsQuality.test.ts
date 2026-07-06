import {
  applyAutoQualityLevel,
  applyDefaultQualityLevel,
  applyManualQualityLevel,
  findHighestLevelIndex,
  findLevelIndexByHeight,
  findNextLowerLevelIndex,
  seedAutoQualityStartLevel,
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

  it('sets default quality without a user manual lock', () => {
    const hls = {
      levels: [{ height: 360 }, { height: 720 }],
      startLevel: -1,
      currentLevel: -1,
      loadLevel: -1,
      nextLevel: -1,
      nextLoadLevel: -1,
      autoLevelCapping: 0,
      __icetvManualQualityLocked: true,
    };

    applyDefaultQualityLevel(hls, 1);

    expect(hls).toMatchObject({
      startLevel: -1,
      currentLevel: 1,
      loadLevel: -1,
      nextLevel: -1,
      nextLoadLevel: -1,
      autoLevelCapping: -1,
      __icetvManualQualityLocked: false,
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

  it('can seed auto mode from a high start level without locking quality', () => {
    const hls = {
      levels: [{ height: 360 }, { height: 720 }, { height: 1080 }],
      startLevel: -1,
      currentLevel: 1,
      loadLevel: 1,
      nextLevel: 1,
      nextLoadLevel: 1,
      nextAutoLevel: -1,
      autoLevelCapping: -1,
      __icetvManualQualityLocked: true,
    };

    applyAutoQualityLevel(hls, { startLevelIndex: 2 });

    expect(hls).toMatchObject({
      startLevel: 2,
      currentLevel: -1,
      loadLevel: -1,
      nextLevel: -1,
      nextLoadLevel: -1,
      nextAutoLevel: 2,
      autoLevelCapping: -1,
      __icetvManualQualityLocked: false,
    });
  });

  it('picks the highest level by height and bitrate', () => {
    expect(
      findHighestLevelIndex([
        { height: 720, bitrate: 2000 },
        { height: 1080, bitrate: 3000 },
        { height: 1080, bitrate: 4500 },
        { height: 480, bitrate: 1200 },
      ]),
    ).toBe(2);
  });

  it('finds the closest level for a stored height preference', () => {
    expect(
      findLevelIndexByHeight(
        [
          { height: 240, bitrate: 256 },
          { height: 480, bitrate: 1000 },
          { height: 720, bitrate: 2500 },
        ],
        1080,
      ),
    ).toBe(2);
  });

  it('finds the next lower level by height', () => {
    expect(
      findNextLowerLevelIndex(
        [
          { height: 240, bitrate: 100 },
          { height: 360, bitrate: 200 },
          { height: 720, bitrate: 512 },
          { height: 1080, bitrate: 2000 },
        ],
        3,
      ),
    ).toBe(2);
  });

  it('seeds auto start level without touching active load selectors', () => {
    const hls = {
      levels: [{ height: 360 }, { height: 720 }, { height: 1080 }],
      startLevel: -1,
      currentLevel: 1,
      loadLevel: 1,
      nextLevel: 1,
      nextLoadLevel: 1,
      nextAutoLevel: -1,
      autoLevelCapping: 0,
      __icetvManualQualityLocked: true,
    };

    seedAutoQualityStartLevel(hls, 2);

    expect(hls).toMatchObject({
      startLevel: 2,
      currentLevel: 1,
      loadLevel: 1,
      nextLevel: 1,
      nextLoadLevel: 1,
      nextAutoLevel: 2,
      autoLevelCapping: -1,
      __icetvManualQualityLocked: false,
    });
  });
});
