import type Artplayer from 'artplayer';
import type { MutableRefObject } from 'react';

import { createVodHlsQualityController } from '@/features/play/lib/vodHlsQualityController';
import { SOURCE_PREFERRED_QUALITY_STORAGE_PREFIX } from '@/lib/local-preferences';

function createArtPlayerRef() {
  const update = jest.fn();
  const remove = jest.fn();
  const art = {
    controls: { update, remove },
    notice: { show: '' },
  } as unknown as Artplayer;
  return {
    art,
    ref: { current: art } as MutableRefObject<Artplayer | null>,
    remove,
    update,
  };
}

function createHls(levels = [240, 360, 480, 720, 1080]) {
  return {
    levels: levels.map((height, index) => ({
      height,
      maxBitrate: [120_000, 220_000, 360_000, 620_000, 1_500_000][index],
    })),
    config: { minAutoBitrate: 0 },
    currentLevel: -1,
    startLevel: -1,
    loadLevel: -1,
    nextLevel: -1,
    nextLoadLevel: -1,
    nextAutoLevel: -1,
    autoLevelCapping: -1,
    autoLevelEnabled: false,
    __icetvManualQualityLocked: false,
    __icetvDefaultQualityLevel: null,
    startLoad: jest.fn(),
  };
}

function createVideo(currentTime = 0, bufferedEnd = 0, duration = 1800) {
  const state = { bufferedEnd };
  return {
    state,
    video: {
      currentTime,
      duration,
      buffered: {
        get length() {
          return state.bufferedEnd > currentTime ? 1 : 0;
        },
        start: () => currentTime,
        end: () => state.bufferedEnd,
      },
    } as Pick<HTMLVideoElement, 'buffered' | 'currentTime' | 'duration'>,
  };
}

describe('VOD HLS quality controller', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('registers xigua controls with a 720p default', () => {
    const hls = createHls();
    const art = createArtPlayerRef();
    const controller = createVodHlsQualityController({
      sourceKey: 'xigua',
      hls,
      video: createVideo().video,
      artPlayerRef: art.ref,
      setRealtimeLoadSpeed: jest.fn(),
    });

    controller.handleManifestParsed();

    expect(controller.isActive()).toBe(true);
    expect(hls.currentLevel).toBe(3);
    expect(hls.__icetvDefaultQualityLevel).toBe(3);
    expect(art.update).toHaveBeenCalledTimes(1);
  });

  it('stores selections per source and caps auto mode at 720p', () => {
    const hls = createHls();
    const art = createArtPlayerRef();
    const controller = createVodHlsQualityController({
      sourceKey: 'xigua',
      hls,
      video: createVideo().video,
      artPlayerRef: art.ref,
      setRealtimeLoadSpeed: jest.fn(),
    });
    controller.handleManifestParsed();
    const control = art.update.mock.calls[0][0] as {
      onSelect: (item: {
        html: string;
        levelIndex: number;
        height: number;
      }) => string;
    };

    control.onSelect({ html: '自动', levelIndex: -1, height: 0 });

    expect(
      localStorage.getItem(`${SOURCE_PREFERRED_QUALITY_STORAGE_PREFIX}xigua`),
    ).toBe('auto');
    expect(hls.startLevel).toBe(3);
    expect(hls.loadLevel).toBe(-1);
    expect(hls.nextAutoLevel).toBe(3);
    expect(hls.autoLevelCapping).toBe(3);
  });

  it('restores a source-scoped manual selection as a manual lock', () => {
    localStorage.setItem(
      `${SOURCE_PREFERRED_QUALITY_STORAGE_PREFIX}xigua`,
      '1080',
    );
    const hls = createHls();
    const art = createArtPlayerRef();
    const controller = createVodHlsQualityController({
      sourceKey: 'xigua',
      hls,
      video: createVideo().video,
      artPlayerRef: art.ref,
      setRealtimeLoadSpeed: jest.fn(),
    });

    controller.handleManifestParsed();

    expect(hls.currentLevel).toBe(4);
    expect(hls.loadLevel).toBe(4);
    expect(hls.autoLevelCapping).toBe(-1);
    expect(hls.__icetvManualQualityLocked).toBe(true);
  });

  it('does not activate controls for unconfigured or single-level sources', () => {
    const unconfiguredHls = createHls();
    const unconfiguredArt = createArtPlayerRef();
    const unconfiguredController = createVodHlsQualityController({
      sourceKey: 'other',
      hls: unconfiguredHls,
      video: createVideo().video,
      artPlayerRef: unconfiguredArt.ref,
      setRealtimeLoadSpeed: jest.fn(),
    });
    unconfiguredController.handleManifestParsed();

    const singleLevelHls = createHls([720]);
    const singleLevelArt = createArtPlayerRef();
    const singleLevelController = createVodHlsQualityController({
      sourceKey: 'xigua',
      hls: singleLevelHls,
      video: createVideo().video,
      artPlayerRef: singleLevelArt.ref,
      setRealtimeLoadSpeed: jest.fn(),
    });
    singleLevelController.handleManifestParsed();

    expect(unconfiguredController.isActive()).toBe(false);
    expect(unconfiguredArt.update).not.toHaveBeenCalled();
    expect(unconfiguredArt.remove).toHaveBeenCalledWith('icetv-quality');
    expect(singleLevelController.isActive()).toBe(false);
    expect(singleLevelArt.update).not.toHaveBeenCalled();
  });

  it('downgrades only an active configured source after a fatal fragment error', () => {
    const hls = createHls();
    const art = createArtPlayerRef();
    const setRealtimeLoadSpeed = jest.fn();
    const controller = createVodHlsQualityController({
      sourceKey: 'xigua',
      hls,
      video: createVideo().video,
      artPlayerRef: art.ref,
      setRealtimeLoadSpeed,
    });
    controller.handleManifestParsed();
    hls.currentLevel = 4;
    hls.loadLevel = 4;

    const handled = controller.tryRecoverFatalNetworkFailure({
      isFragmentNetworkError: true,
      isFragmentOrLevelNetworkError: true,
    });

    expect(handled).toBe(true);
    expect(hls.nextAutoLevel).toBe(3);
    expect(hls.autoLevelCapping).toBe(3);
    expect(hls.startLoad).toHaveBeenCalledTimes(1);
    expect(setRealtimeLoadSpeed).toHaveBeenCalledWith(
      '当前画质分片加载失败，已切换到720p',
    );
  });

  it('cancels delayed control registration when disposed', () => {
    jest.useFakeTimers();
    try {
      const hls = createHls();
      const art = createArtPlayerRef();
      const ref = { current: null } as MutableRefObject<Artplayer | null>;
      const controller = createVodHlsQualityController({
        sourceKey: 'xigua',
        hls,
        video: createVideo().video,
        artPlayerRef: ref,
        setRealtimeLoadSpeed: jest.fn(),
      });
      controller.handleManifestParsed();
      controller.dispose();
      ref.current = art.art;

      jest.runAllTimers();

      expect(art.update).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('opens 480p only below the emergency buffer and restores 720p', () => {
    localStorage.setItem(
      `${SOURCE_PREFERRED_QUALITY_STORAGE_PREFIX}xigua`,
      'auto',
    );
    const hls = createHls();
    hls.autoLevelEnabled = true;
    const bufferedVideo = createVideo(100, 125);
    const controller = createVodHlsQualityController({
      sourceKey: 'xigua',
      hls,
      video: bufferedVideo.video,
      artPlayerRef: createArtPlayerRef().ref,
      setRealtimeLoadSpeed: jest.fn(),
    });
    controller.handleManifestParsed();

    bufferedVideo.state.bufferedEnd = 105.5;
    controller.handleFragmentLoading(3);
    expect(hls.config.minAutoBitrate).toBe(220_001);

    bufferedVideo.state.bufferedEnd = 130;
    controller.handleBufferUpdated();
    expect(hls.config.minAutoBitrate).toBe(360_001);
    expect(hls.nextLoadLevel).toBe(3);
    expect(hls.nextAutoLevel).toBe(3);

    hls.nextLoadLevel = 2;
    hls.nextAutoLevel = 2;
    controller.handleFragmentLoading(2);
    expect(hls.nextLoadLevel).toBe(3);
    expect(hls.nextAutoLevel).toBe(3);
  });

  it('keeps a manual 720p selection locked after network failures', () => {
    localStorage.setItem(
      `${SOURCE_PREFERRED_QUALITY_STORAGE_PREFIX}xigua`,
      '720',
    );
    const hls = createHls();
    const controller = createVodHlsQualityController({
      sourceKey: 'xigua',
      hls,
      video: createVideo(0, 25).video,
      artPlayerRef: createArtPlayerRef().ref,
      setRealtimeLoadSpeed: jest.fn(),
    });
    controller.handleManifestParsed();

    expect(controller.tryRecoverManualSelectionFailure(true)).toBe(false);
    expect(controller.tryRecoverManualSelectionFailure(true)).toBe(false);
    expect(hls.__icetvManualQualityLocked).toBe(true);
    expect(hls.currentLevel).toBe(3);
  });
});
