import type Artplayer from 'artplayer';
import { Converter } from 'opencc-js/cn2t';

import {
  applyAutoQualityLevel,
  applyDefaultQualityLevel,
  applyManualQualityLevel,
  findHighestLevelIndex,
  findLevelIndexByHeight,
  findNextLowerLevelIndex,
  registerQualityControlWhenReady,
  seedAutoQualityStartLevel,
} from '@/features/play/lib/hlsQuality';
import { type DisplayTextGlobals } from '@/lib/display-text';

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
      currentLevel: 1,
      loadLevel: -1,
      nextLevel: 1,
      nextLoadLevel: 1,
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
      currentLevel: 1,
      loadLevel: -1,
      nextLevel: 1,
      nextLoadLevel: 1,
      nextAutoLevel: 2,
      autoLevelCapping: -1,
      __icetvManualQualityLocked: false,
    });
  });

  it('caps auto mode without limiting manual selection', () => {
    const hls = {
      levels: [
        { height: 360, maxBitrate: 200_000 },
        { height: 720, maxBitrate: 600_000 },
        { height: 1080, maxBitrate: 1_500_000 },
      ],
      config: { minAutoBitrate: 0 },
      startLevel: -1,
      currentLevel: -1,
      loadLevel: -1,
      nextLevel: -1,
      nextLoadLevel: -1,
      nextAutoLevel: -1,
      autoLevelCapping: -1,
      __icetvManualQualityLocked: false,
    };

    applyAutoQualityLevel(hls, {
      startLevelIndex: 2,
      minLevelIndex: 1,
      maxLevelIndex: 1,
    });

    expect(hls.startLevel).toBe(1);
    expect(hls.nextAutoLevel).toBe(1);
    expect(hls.autoLevelCapping).toBe(1);
    expect(hls.config.minAutoBitrate).toBe(200_001);

    applyManualQualityLevel(hls, 2, { userSelected: true });

    expect(hls.currentLevel).toBe(2);
    expect(hls.autoLevelCapping).toBe(-1);
    expect(hls.config.minAutoBitrate).toBe(0);
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

  it('seeds auto mode with a maximum level', () => {
    const hls = {
      levels: [{ height: 360 }, { height: 720 }, { height: 1080 }],
      startLevel: -1,
      currentLevel: -1,
      loadLevel: -1,
      nextLevel: -1,
      nextLoadLevel: -1,
      nextAutoLevel: -1,
      autoLevelCapping: -1,
      __icetvManualQualityLocked: true,
    };

    seedAutoQualityStartLevel(hls, 2, null, 1);

    expect(hls.startLevel).toBe(1);
    expect(hls.nextAutoLevel).toBe(1);
    expect(hls.autoLevelCapping).toBe(1);
    expect(hls.__icetvManualQualityLocked).toBe(false);
  });
});

describe('画质显示边界', () => {
  const globals = globalThis as DisplayTextGlobals;
  afterEach(() => {
    document.documentElement.lang = '';
    delete globals.__ICETV_DISPLAY_CONVERTER__;
  });

  it('转换自动与默认标签、notice，保留档位索引和写入的画质偏好', () => {
    document.documentElement.lang = 'zh-TW';
    globals.__ICETV_DISPLAY_CONVERTER__ = Converter({ from: 'cn', to: 'twp' });
    const update = jest.fn();
    const onPreferenceChange = jest.fn();
    const art = {
      controls: { update, remove: jest.fn() },
      notice: { show: '' },
    } as unknown as Artplayer;
    const hls = {
      levels: [{ height: 720 }, {}],
      currentLevel: 0,
      startLevel: 0,
    };
    registerQualityControlWhenReady({ current: art }, hls, {
      preference: { mode: 'auto' },
      defaultLevelIndex: null,
      autoStartLevelIndex: null,
      autoInitialMinLevelIndex: null,
      autoMaxLevelIndex: null,
      onPreferenceChange,
    });
    const control = update.mock.calls[0][0];
    expect(control.name).toBe('icetv-quality');
    expect(control.html).toBe('自動');
    expect(control.selector.map((item: { html: string }) => item.html)).toEqual(
      ['自動', '720p', '預設'],
    );
    expect(control.onSelect(control.selector[1])).toBe('720p');
    expect(onPreferenceChange).toHaveBeenLastCalledWith(720);
    expect(hls.currentLevel).toBe(0);
    expect(art.notice.show).toBe('畫質: 720p');
    control.onSelect(control.selector[0]);
    expect(onPreferenceChange).toHaveBeenLastCalledWith(null);
    expect(art.notice.show).toBe('畫質: 自動');
  });
});
