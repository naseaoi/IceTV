import { renderHook } from '@testing-library/react';
import type Artplayer from 'artplayer';

import {
  buildPlayDocumentTitle,
  usePlayMediaSession,
} from '@/features/play/hooks/usePlayMediaSession';

type Handler = (details: Record<string, unknown>) => void;

describe('usePlayMediaSession', () => {
  const handlers = new Map<string, Handler | null>();
  const mediaSession = {
    metadata: null as unknown,
    playbackState: 'none',
    setActionHandler: jest.fn((action: string, handler: Handler | null) => {
      handlers.set(action, handler);
    }),
    setPositionState: jest.fn(),
  };

  beforeAll(() => {
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: mediaSession,
    });
    (globalThis as unknown as { MediaMetadata: unknown }).MediaMetadata =
      class {
        constructor(public init: Record<string, unknown>) {}
      };
  });

  afterAll(() => {
    delete (navigator as unknown as { mediaSession?: unknown }).mediaSession;
    delete (globalThis as unknown as { MediaMetadata?: unknown }).MediaMetadata;
  });

  beforeEach(() => {
    handlers.clear();
    mediaSession.setPositionState.mockClear();
  });

  function setup(
    overrides: Partial<Parameters<typeof usePlayMediaSession>[0]> = {},
  ) {
    const video = document.createElement('video');
    document.body.appendChild(video);
    const player = {
      video,
      currentTime: 100,
      duration: 1200,
      seek: 0,
      play: jest.fn(async () => undefined),
      pause: jest.fn(),
    };
    const onPreviousEpisode = jest.fn();
    const onNextEpisode = jest.fn();
    const props = {
      artPlayerRef: { current: player as unknown as Artplayer },
      videoTitle: '孤独摇滚！',
      episodeLabel: '第 4 集',
      videoCover: '',
      hasPreviousEpisode: true,
      hasNextEpisode: false,
      onPreviousEpisode,
      onNextEpisode,
      ...overrides,
    };
    const view = renderHook((p: typeof props) => usePlayMediaSession(p), {
      initialProps: props,
    });
    return { ...view, player, video, onPreviousEpisode, onNextEpisode };
  }

  it('页面标题带作品与集数，离开播放页还原站点名', () => {
    const { unmount } = setup();
    expect(document.title).toBe('孤独摇滚！ - 第 4 集 - IceTV');
    unmount();
    expect(document.title).toBe('IceTV');
  });

  it('系统控件可快退并切到上一集，没有下一集时不注册下一集', () => {
    const { player, onPreviousEpisode } = setup();

    handlers.get('seekbackward')?.({});
    expect(player.seek).toBe(90);
    handlers.get('previoustrack')?.({});
    expect(onPreviousEpisode).toHaveBeenCalledTimes(1);
    expect(handlers.get('nexttrack')).toBeNull();
  });

  it('只同步当前播放器的媒体事件', () => {
    const { video } = setup();
    const other = document.createElement('video');
    document.body.appendChild(other);

    other.dispatchEvent(new Event('pause'));
    expect(mediaSession.setPositionState).not.toHaveBeenCalled();

    Object.defineProperty(video, 'duration', { value: 1200 });
    video.dispatchEvent(new Event('durationchange'));
    expect(mediaSession.setPositionState).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 1200 }),
    );
  });
});

describe('buildPlayDocumentTitle', () => {
  it('没有标题时只显示站点名', () => {
    expect(
      buildPlayDocumentTitle({
        siteName: 'IceTV',
        videoTitle: ' ',
        episodeLabel: null,
      }),
    ).toBe('IceTV');
  });
});
