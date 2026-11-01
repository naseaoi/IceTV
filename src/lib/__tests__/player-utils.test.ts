import Artplayer from 'artplayer';

import {
  configureArtplayerStatics,
  createHlsFatalRecoveryController,
  destroyArtPlayer,
  HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS,
  HLS_FATAL_RECOVERY_RESET_PLAYBACK_SECONDS,
} from '@/lib/player-utils';

const ErrorTypes = {
  NETWORK_ERROR: 'networkError',
  MEDIA_ERROR: 'mediaError',
};

function createTarget() {
  return {
    startLoad: jest.fn(),
    recoverMediaError: jest.fn(),
    swapAudioCodec: jest.fn(),
  };
}

function mainFragment(sn: number | 'initSegment') {
  return { sn, type: 'main' };
}

function playContinuously(
  controller: ReturnType<typeof createHlsFatalRecoveryController>,
  from: number,
  seconds: number,
) {
  for (let offset = 0; offset <= seconds; offset += 0.25) {
    controller.handlePlaybackProgress(from + offset);
  }
}

describe('HLS fatal recovery controller', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('restarts loading with backoff until network attempts run out', () => {
    const controller = createHlsFatalRecoveryController();
    const target = createTarget();

    for (const delayMs of HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS) {
      expect(
        controller.recover(target, ErrorTypes.NETWORK_ERROR, ErrorTypes),
      ).toBe('recovering');
      const calls = target.startLoad.mock.calls.length;
      jest.advanceTimersByTime(delayMs - 1);
      expect(target.startLoad).toHaveBeenCalledTimes(calls);
      jest.advanceTimersByTime(1);
      expect(target.startLoad).toHaveBeenCalledTimes(calls + 1);
    }

    expect(
      controller.recover(target, ErrorTypes.NETWORK_ERROR, ErrorTypes),
    ).toBe('exhausted');
    expect(target.startLoad).toHaveBeenCalledTimes(
      HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS.length,
    );
  });

  it('does not stack network retries while one is pending', () => {
    const controller = createHlsFatalRecoveryController();
    const target = createTarget();

    controller.recover(target, ErrorTypes.NETWORK_ERROR, ErrorTypes);
    expect(
      controller.recover(target, ErrorTypes.NETWORK_ERROR, ErrorTypes),
    ).toBe('recovering');
    jest.runOnlyPendingTimers();

    expect(target.startLoad).toHaveBeenCalledTimes(1);
  });

  it('clears the network budget after a fragment loads', () => {
    const controller = createHlsFatalRecoveryController();
    const target = createTarget();

    for (let i = 0; i < HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS.length; i += 1) {
      controller.recover(target, ErrorTypes.NETWORK_ERROR, ErrorTypes);
      jest.runOnlyPendingTimers();
    }
    controller.handleFragmentLoaded();

    expect(
      controller.recover(target, ErrorTypes.NETWORK_ERROR, ErrorTypes),
    ).toBe('recovering');
  });

  it('keeps the network budget while only fragments before the failed one load', () => {
    const controller = createHlsFatalRecoveryController();
    const target = createTarget();

    for (const delayMs of HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS) {
      expect(
        controller.recover(
          target,
          ErrorTypes.NETWORK_ERROR,
          ErrorTypes,
          mainFragment(11),
        ),
      ).toBe('recovering');
      jest.advanceTimersByTime(delayMs);
      expect(controller.handleFragmentLoaded(mainFragment(10))).toBe(false);
    }

    expect(
      controller.recover(
        target,
        ErrorTypes.NETWORK_ERROR,
        ErrorTypes,
        mainFragment(11),
      ),
    ).toBe('exhausted');
    expect(target.startLoad).toHaveBeenCalledTimes(
      HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS.length,
    );
  });

  it.each([11, 12])(
    'clears the network budget once fragment %i reaches the failed position',
    (loadedSn) => {
      const controller = createHlsFatalRecoveryController();
      const target = createTarget();

      for (let i = 0; i < HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS.length; i += 1) {
        controller.recover(
          target,
          ErrorTypes.NETWORK_ERROR,
          ErrorTypes,
          mainFragment(11),
        );
        jest.runOnlyPendingTimers();
      }

      expect(controller.handleFragmentLoaded(mainFragment(loadedSn))).toBe(
        true,
      );
      expect(
        controller.recover(target, ErrorTypes.NETWORK_ERROR, ErrorTypes),
      ).toBe('recovering');
      // 到达失败位置后位置已清除，之后不带分片的失败回到任意分片都算恢复
      jest.runOnlyPendingTimers();
      expect(controller.handleFragmentLoaded(mainFragment(3))).toBe(true);
    },
  );

  it('only matches media fragments of the failed track type', () => {
    const controller = createHlsFatalRecoveryController();
    const target = createTarget();

    controller.recover(
      target,
      ErrorTypes.NETWORK_ERROR,
      ErrorTypes,
      mainFragment(11),
    );
    jest.runOnlyPendingTimers();

    expect(controller.handleFragmentLoaded(mainFragment('initSegment'))).toBe(
      false,
    );
    expect(controller.handleFragmentLoaded({ sn: 20, type: 'audio' })).toBe(
      false,
    );
    expect(controller.handleFragmentLoaded(undefined)).toBe(false);
    expect(controller.handleFragmentLoaded(mainFragment(11))).toBe(true);
  });

  it('keeps the recorded position across failures without a fragment', () => {
    const controller = createHlsFatalRecoveryController();
    const target = createTarget();

    controller.recover(
      target,
      ErrorTypes.NETWORK_ERROR,
      ErrorTypes,
      mainFragment(11),
    );
    jest.runOnlyPendingTimers();
    controller.recover(target, ErrorTypes.NETWORK_ERROR, ErrorTypes);
    jest.runOnlyPendingTimers();

    expect(controller.handleFragmentLoaded(mainFragment(10))).toBe(false);
    expect(controller.handleFragmentLoaded(mainFragment(11))).toBe(true);
  });

  it('lets any fragment clear failures that carry no fragment position', () => {
    const controller = createHlsFatalRecoveryController();
    const target = createTarget();

    for (let i = 0; i < HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS.length; i += 1) {
      controller.recover(
        target,
        ErrorTypes.NETWORK_ERROR,
        ErrorTypes,
        mainFragment('initSegment'),
      );
      jest.runOnlyPendingTimers();
    }

    expect(controller.handleFragmentLoaded(mainFragment(0))).toBe(true);
    expect(
      controller.recover(target, ErrorTypes.NETWORK_ERROR, ErrorTypes),
    ).toBe('recovering');
  });

  it('does not count being stuck at the buffered end as sustained playback', () => {
    const controller = createHlsFatalRecoveryController();
    const target = createTarget();

    for (const delayMs of HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS) {
      controller.recover(
        target,
        ErrorTypes.NETWORK_ERROR,
        ErrorTypes,
        mainFragment(11),
      );
      jest.advanceTimersByTime(delayMs);
      controller.handleFragmentLoaded(mainFragment(10));
      for (let i = 0; i < 80; i += 1) {
        controller.handlePlaybackProgress(109.5);
      }
    }

    expect(
      controller.recover(
        target,
        ErrorTypes.NETWORK_ERROR,
        ErrorTypes,
        mainFragment(11),
      ),
    ).toBe('exhausted');
  });

  it('forgets the failed position after sustained playback or reset', () => {
    const controller = createHlsFatalRecoveryController();
    const target = createTarget();

    controller.recover(
      target,
      ErrorTypes.NETWORK_ERROR,
      ErrorTypes,
      mainFragment(11),
    );
    jest.runOnlyPendingTimers();
    playContinuously(controller, 30, HLS_FATAL_RECOVERY_RESET_PLAYBACK_SECONDS);
    expect(controller.handleFragmentLoaded(mainFragment(10))).toBe(true);

    controller.recover(
      target,
      ErrorTypes.NETWORK_ERROR,
      ErrorTypes,
      mainFragment(11),
    );
    controller.reset();
    expect(controller.handleFragmentLoaded(mainFragment(10))).toBe(true);
  });

  it('swaps the audio codec on the second media recovery only', () => {
    const controller = createHlsFatalRecoveryController();
    const target = createTarget();

    expect(controller.recover(target, ErrorTypes.MEDIA_ERROR, ErrorTypes)).toBe(
      'recovering',
    );
    expect(target.swapAudioCodec).not.toHaveBeenCalled();
    expect(target.recoverMediaError).toHaveBeenCalledTimes(1);

    expect(controller.recover(target, ErrorTypes.MEDIA_ERROR, ErrorTypes)).toBe(
      'recovering',
    );
    expect(target.swapAudioCodec).toHaveBeenCalledTimes(1);
    expect(target.recoverMediaError).toHaveBeenCalledTimes(2);

    expect(controller.recover(target, ErrorTypes.MEDIA_ERROR, ErrorTypes)).toBe(
      'exhausted',
    );
    expect(target.recoverMediaError).toHaveBeenCalledTimes(2);
  });

  it('keeps the media budget when fragments still load', () => {
    const controller = createHlsFatalRecoveryController();
    const target = createTarget();

    controller.recover(target, ErrorTypes.MEDIA_ERROR, ErrorTypes);
    controller.recover(target, ErrorTypes.MEDIA_ERROR, ErrorTypes);
    controller.handleFragmentLoaded();

    expect(controller.recover(target, ErrorTypes.MEDIA_ERROR, ErrorTypes)).toBe(
      'exhausted',
    );
  });

  it('restores every budget after sustained playback', () => {
    const controller = createHlsFatalRecoveryController();
    const target = createTarget();

    controller.recover(target, ErrorTypes.MEDIA_ERROR, ErrorTypes);
    controller.recover(target, ErrorTypes.MEDIA_ERROR, ErrorTypes);
    playContinuously(
      controller,
      30,
      HLS_FATAL_RECOVERY_RESET_PLAYBACK_SECONDS - 1,
    );
    expect(controller.recover(target, ErrorTypes.MEDIA_ERROR, ErrorTypes)).toBe(
      'exhausted',
    );

    playContinuously(controller, 30, HLS_FATAL_RECOVERY_RESET_PLAYBACK_SECONDS);
    expect(controller.recover(target, ErrorTypes.MEDIA_ERROR, ErrorTypes)).toBe(
      'recovering',
    );
  });

  it('does not treat seeks as sustained playback', () => {
    const controller = createHlsFatalRecoveryController();
    const target = createTarget();

    controller.recover(target, ErrorTypes.MEDIA_ERROR, ErrorTypes);
    controller.recover(target, ErrorTypes.MEDIA_ERROR, ErrorTypes);
    controller.handlePlaybackProgress(0);
    controller.handlePlaybackProgress(1200);
    controller.handlePlaybackProgress(1200.25);

    expect(controller.recover(target, ErrorTypes.MEDIA_ERROR, ErrorTypes)).toBe(
      'exhausted',
    );
  });

  it('leaves other fatal errors to the caller', () => {
    const controller = createHlsFatalRecoveryController();

    expect(controller.recover(createTarget(), 'otherError', ErrorTypes)).toBe(
      'unrecoverable',
    );
  });

  it('cancels pending retries after reset and dispose', () => {
    const controller = createHlsFatalRecoveryController();
    const target = createTarget();

    controller.recover(target, ErrorTypes.NETWORK_ERROR, ErrorTypes);
    controller.reset();
    jest.runOnlyPendingTimers();
    expect(target.startLoad).not.toHaveBeenCalled();

    controller.recover(target, ErrorTypes.NETWORK_ERROR, ErrorTypes);
    controller.dispose();
    jest.runOnlyPendingTimers();
    expect(target.startLoad).not.toHaveBeenCalled();
    expect(controller.recover(target, ErrorTypes.MEDIA_ERROR, ErrorTypes)).toBe(
      'recovering',
    );
    expect(target.recoverMediaError).not.toHaveBeenCalled();
  });
});

function createFakePlayer(fullscreenWeb: boolean) {
  const steps: string[] = [];
  let state = fullscreenWeb;
  const player = {
    get fullscreenWeb() {
      return state;
    },
    set fullscreenWeb(value: boolean) {
      steps.push(`fullscreenWeb:${value}`);
      state = value;
    },
    destroy: jest.fn(() => {
      steps.push('destroy');
    }),
  };
  return { player, steps };
}

describe('destroyArtPlayer', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('leaves web fullscreen before destroying', () => {
    const { player, steps } = createFakePlayer(true);

    destroyArtPlayer(player);

    expect(steps).toEqual(['fullscreenWeb:false', 'destroy']);
  });

  it('destroys directly outside web fullscreen', () => {
    const { player, steps } = createFakePlayer(false);

    destroyArtPlayer(player);

    expect(steps).toEqual(['destroy']);
  });

  it('still destroys when leaving web fullscreen throws', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const player = {
      get fullscreenWeb() {
        return true;
      },
      set fullscreenWeb(_value: boolean) {
        throw new Error('exit failed');
      },
      destroy: jest.fn(),
    };

    destroyArtPlayer(player);

    expect(player.destroy).toHaveBeenCalledTimes(1);
  });

  it('removes the player that web fullscreen moved into body', () => {
    configureArtplayerStatics(Artplayer);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const art = new Artplayer({ container, url: '' });
    art.fullscreenWeb = true;
    const { $player } = art.template;
    expect($player.parentElement).toBe(document.body);

    destroyArtPlayer(art);

    expect(document.body.contains($player)).toBe(false);
    container.remove();
  });
});
