import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import LiveLoading from '@/app/live/loading';
import LivePage, { LivePlayerOverlay } from '@/features/live/LivePageClient';

const mockUseLiveSources = jest.fn();
const mockUseLivePlayer = jest.fn();

jest.mock('@/components/AuthenticatedRoute', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/PlayerShortcutsModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/features/live/components/LiveChannelSidebar', () => ({
  LiveChannelSidebar: () => <div data-testid='live-channel-sidebar' />,
}));

jest.mock('@/features/live/hooks/useLiveFavorite', () => ({
  useLiveFavorite: () => ({
    ready: true,
    isGroupFavorited: () => false,
    toggleGroupFavorite: jest.fn(),
    favoriteGroups: [],
  }),
}));

jest.mock('@/features/live/hooks/useLivePlayer', () => ({
  useLivePlayer: (...args: unknown[]) => mockUseLivePlayer(...args),
}));

jest.mock('@/features/live/hooks/useLiveSources', () => ({
  useLiveSources: (...args: unknown[]) => mockUseLiveSources(...args),
}));

jest.mock('@/hooks/useBackNavigation', () => ({
  useBackNavigation: () => jest.fn(),
}));

jest.mock('@/hooks/usePlayerKeyboard', () => ({
  usePlayerKeyboard: jest.fn(),
}));

describe('LivePlayerOverlay', () => {
  it('keeps loading and unsupported overlays transparent to player input', () => {
    const { rerender } = render(
      <LivePlayerOverlay
        unsupportedType={null}
        isVideoLoading
        playbackFailed={false}
        onRetry={jest.fn()}
        inactivityStopped={false}
        onResume={jest.fn()}
      />,
    );

    expect(
      screen.getByText('正在连接直播流').closest('[data-player-overlay]'),
    ).toHaveClass('pointer-events-none');

    rerender(
      <LivePlayerOverlay
        unsupportedType='flv'
        isVideoLoading={false}
        playbackFailed={false}
        onRetry={jest.fn()}
        inactivityStopped={false}
        onResume={jest.fn()}
      />,
    );

    expect(
      screen.getByText('暂不支持的直播流类型').closest('[data-player-overlay]'),
    ).toHaveClass('pointer-events-none');
  });

  it('lets the playback failure overlay receive the retry click', () => {
    const onRetry = jest.fn();
    render(
      <LivePlayerOverlay
        unsupportedType={null}
        isVideoLoading={false}
        playbackFailed
        onRetry={onRetry}
        inactivityStopped={false}
        onResume={jest.fn()}
      />,
    );

    expect(
      screen.getByText('直播流加载失败').closest('[data-player-overlay]'),
    ).not.toHaveClass('pointer-events-none');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the inactivity pause overlay with a resume action', () => {
    const onResume = jest.fn();
    render(
      <LivePlayerOverlay
        unsupportedType={null}
        isVideoLoading={false}
        playbackFailed={false}
        onRetry={jest.fn()}
        inactivityStopped
        onResume={onResume}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '继续观看' }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});

describe('LivePage', () => {
  beforeEach(() => {
    window.matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
  });
  it.each([1, 2])(
    'shares loading and ready layout with %i channel lines',
    (lineCount) => {
      const sources = {
        loading: true,
        loadingMessage: '获取直播源',
        error: null,
        videoUrl: '',
        currentChannel: null,
        currentChannelRef: { current: null },
        currentChannels: [],
        currentSource: null,
        currentSourceRef: { current: null },
        isVideoLoading: false,
        unsupportedType: null,
        isChannelListCollapsed: false,
      };
      mockUseLiveSources.mockReturnValue(sources);
      mockUseLivePlayer.mockReturnValue({
        artPlayerRef: { current: null },
        cleanupPlayer: jest.fn(),
        playbackFailed: false,
        retryPlayback: jest.fn(),
      });
      const { container, rerender } = render(<LiveLoading />);
      const readLayoutClasses = () =>
        Array.from(
          container.querySelectorAll(
            '[data-player-layout], [data-player-heading], [data-player-video], [data-player-sidebar]',
          ),
          (element) => element.className,
        );
      const readActionClasses = () =>
        container.querySelector('[data-player-heading] > .ml-auto > div')
          ?.className;
      const loadingLayout = readLayoutClasses();
      const loadingActions = readActionClasses();
      expect(loadingActions).toBeTruthy();

      rerender(<LivePage />);
      const playerContainer = container.querySelector('[data-player-video]');
      expect(playerContainer).not.toBeNull();
      expect(readLayoutClasses()).toEqual(loadingLayout);
      expect(readActionClasses()).toBe(loadingActions);
      expect(screen.getByText('获取直播源')).toBeInTheDocument();

      const channels = Array.from({ length: lineCount }, (_, index) => ({
        id: `ch${index}`,
        tvgId: 'ch1',
        name: '频道一',
        logo: '',
        group: '央视',
        url: `https://example.com/ch${index}.m3u8`,
      }));
      mockUseLiveSources.mockReturnValue({
        ...sources,
        loading: false,
        currentChannel: channels[0],
        currentChannels: channels,
      });
      rerender(<LivePage />);
      expect(container.querySelector('[data-player-video]')).toBe(
        playerContainer,
      );
      expect(readLayoutClasses()).toEqual(loadingLayout);
      expect(readActionClasses()).toBe(loadingActions);
      expect(screen.getByTestId('live-channel-sidebar')).toBeInTheDocument();
    },
  );

  it('keeps the channel panel and retries in place when playback fails', () => {
    const channel = {
      id: 'ch1',
      tvgId: 'ch1',
      name: '频道一',
      logo: '',
      group: '央视',
      url: 'https://example.com/ch1.m3u8',
    };
    const retryPlayback = jest.fn();
    mockUseLiveSources.mockReturnValue({
      loading: false,
      error: null,
      videoUrl: channel.url,
      currentChannel: channel,
      currentChannelRef: { current: channel },
      currentChannels: [channel],
      currentSource: null,
      currentSourceRef: { current: null },
      isVideoLoading: false,
      unsupportedType: null,
      isChannelListCollapsed: false,
    });
    mockUseLivePlayer.mockReturnValue({
      artPlayerRef: { current: null },
      cleanupPlayer: jest.fn(),
      playbackFailed: true,
      retryPlayback,
    });

    render(<LivePage />);

    expect(screen.getByTestId('live-channel-sidebar')).toBeInTheDocument();
    expect(screen.queryByText('直播加载失败')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(retryPlayback).toHaveBeenCalledTimes(1);
  });
});
