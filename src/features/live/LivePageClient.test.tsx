import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import LivePage, { LivePlayerOverlay } from '@/features/live/LivePageClient';

const mockUseLiveSources = jest.fn();
const mockUseLivePlayer = jest.fn();

jest.mock('@/components/LoadingStatePanel', () => ({
  __esModule: true,
  default: ({ title, children }: { title: string; children?: ReactNode }) => (
    <>
      <div>{title}</div>
      {children}
    </>
  ),
}));

jest.mock('@/components/AuthenticatedRoute', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/PlayerPageLayout', () => ({
  PlayerPageLayout: ({
    playerOverlay,
    rightPanel,
  }: {
    playerOverlay: ReactNode;
    rightPanel: ReactNode;
  }) => (
    <div>
      {playerOverlay}
      {rightPanel}
    </div>
  ),
}));

jest.mock('@/features/live/components/LiveChannelSidebar', () => ({
  LiveChannelSidebar: () => <div data-testid='live-channel-sidebar' />,
}));

jest.mock('@/features/live/hooks/useLiveFavorite', () => ({
  useLiveFavorite: () => ({
    favorited: false,
    handleToggleFavorite: jest.fn(),
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
      />,
    );

    expect(screen.getByText('IPTV 加载中...').parentElement).toHaveClass(
      'pointer-events-none',
    );

    rerender(
      <LivePlayerOverlay
        unsupportedType='flv'
        isVideoLoading={false}
        playbackFailed={false}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getByText('暂不支持的直播流类型').parentElement).toHaveClass(
      'pointer-events-none',
    );
  });

  it('lets the playback failure overlay receive the retry click', () => {
    const onRetry = jest.fn();
    render(
      <LivePlayerOverlay
        unsupportedType={null}
        isVideoLoading={false}
        playbackFailed
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('直播流加载失败').parentElement).not.toHaveClass(
      'pointer-events-none',
    );
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('LivePage', () => {
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
    expect(screen.queryByText('哎呀，出现了一些问题')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(retryPlayback).toHaveBeenCalledTimes(1);
  });
});
