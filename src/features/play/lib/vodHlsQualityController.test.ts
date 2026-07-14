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
    levels: levels.map((height) => ({ height })),
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
      artPlayerRef: art.ref,
      setRealtimeLoadSpeed: jest.fn(),
    });

    controller.handleManifestParsed();

    expect(controller.isActive()).toBe(true);
    expect(hls.currentLevel).toBe(3);
    expect(hls.__icetvDefaultQualityLevel).toBe(3);
    expect(art.update).toHaveBeenCalledTimes(1);
  });

  it('stores selections per source and starts auto from 720p', () => {
    const hls = createHls();
    const art = createArtPlayerRef();
    const controller = createVodHlsQualityController({
      sourceKey: 'xigua',
      hls,
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
      artPlayerRef: art.ref,
      setRealtimeLoadSpeed: jest.fn(),
    });

    controller.handleManifestParsed();

    expect(hls.currentLevel).toBe(4);
    expect(hls.loadLevel).toBe(4);
    expect(hls.__icetvManualQualityLocked).toBe(true);
  });

  it('does not activate controls for unconfigured or single-level sources', () => {
    const unconfiguredHls = createHls();
    const unconfiguredArt = createArtPlayerRef();
    const unconfiguredController = createVodHlsQualityController({
      sourceKey: 'other',
      hls: unconfiguredHls,
      artPlayerRef: unconfiguredArt.ref,
      setRealtimeLoadSpeed: jest.fn(),
    });
    unconfiguredController.handleManifestParsed();

    const singleLevelHls = createHls([720]);
    const singleLevelArt = createArtPlayerRef();
    const singleLevelController = createVodHlsQualityController({
      sourceKey: 'xigua',
      hls: singleLevelHls,
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
});
