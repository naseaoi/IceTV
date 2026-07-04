import type { ReactNode, RefObject } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { PlayMainContent } from '@/features/play/components/PlayMainContent';
import type { SearchResult } from '@/lib/types';

const PLAYER_LOADING_TIMEOUT_MS = 15_000;

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/BackButton', () => ({
  BackButton: () => <button type='button'>返回</button>,
}));

jest.mock('@/features/play/components/EpisodeSelector', () => ({
  __esModule: true,
  default: () => <div>EpisodeSelector</div>,
}));

jest.mock('@/components/LoadingStatePanel', () => ({
  __esModule: true,
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <div>{title}</div>
      {children}
    </div>
  ),
}));

describe('PlayMainContent', () => {
  const originalMatchMedia = window.matchMedia;
  const originalResizeObserver = global.ResizeObserver;

  const detail: SearchResult = {
    id: 'source-a-id',
    title: '测试视频',
    poster: '',
    episodes: ['https://example.com/a.m3u8'],
    episodes_titles: ['第1集'],
    source: 'source-a',
    source_name: '源站A',
    year: '2026',
    type_name: '剧集',
  };

  beforeEach(() => {
    jest.useFakeTimers();
    window.matchMedia = jest.fn().mockImplementation(() => ({
      matches: true,
      media: '(min-width: 768px)',
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    global.ResizeObserver = class ResizeObserver {
      observe() {}

      disconnect() {}

      unobserve() {}
    };
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    window.matchMedia = originalMatchMedia;
    global.ResizeObserver = originalResizeObserver;
  });

  it('在新的换源轮次开始后重置超时提示', () => {
    const baseProps = {
      videoTitle: '测试视频',
      totalEpisodes: 1,
      detail,
      currentEpisodeIndex: 0,
      isEpisodeSelectorCollapsed: false,
      setIsEpisodeSelectorCollapsed: jest.fn(),
      artRef: { current: null } as RefObject<HTMLDivElement | null>,
      isVideoLoading: true,
      isPlaying: false,
      videoLoadingStage: 'sourceChanging' as const,
      videoLoadingAttempt: 0,
      realtimeLoadSpeed: '测速中...',
      authRecoveryVisible: false,
      authRecoveryReasonMessage: '',
      onReloginAndRecover: jest.fn(),
      onDismissAuthRecovery: jest.fn(),
      onEpisodeChange: jest.fn(),
      onRetryPlayback: jest.fn(),
      onSourceChange: jest.fn(),
      currentSource: 'source-a',
      currentId: 'source-a-id',
      searchTitle: '测试视频',
      availableSources: [
        detail,
        {
          ...detail,
          id: 'source-b-id',
          source: 'source-b',
          source_name: '源站B',
        },
      ],
      sourceSearchLoading: false,
      sourceSearchError: null,
      precomputedVideoInfo: new Map(),
      videoYear: '2026',
      favorited: false,
      onToggleFavorite: jest.fn(),
      videoCover: '',
      videoDoubanId: 0,
    };

    const { rerender } = render(<PlayMainContent {...baseProps} />);

    act(() => {
      jest.advanceTimersByTime(PLAYER_LOADING_TIMEOUT_MS);
    });

    expect(screen.getByText('切换播放源超时')).toBeInTheDocument();

    rerender(
      <PlayMainContent
        {...baseProps}
        currentSource='source-b'
        currentId='source-b-id'
        videoLoadingAttempt={1}
      />,
    );

    expect(screen.queryByText('切换播放源超时')).not.toBeInTheDocument();
    expect(screen.getByText('正在切换源站')).toBeInTheDocument();
  });

  it('在播放器失败层支持继续尝试', () => {
    const onRetryPlayback = jest.fn();

    render(
      <PlayMainContent
        videoTitle='测试视频'
        totalEpisodes={1}
        detail={detail}
        currentEpisodeIndex={0}
        isEpisodeSelectorCollapsed={false}
        setIsEpisodeSelectorCollapsed={jest.fn()}
        artRef={{ current: null } as RefObject<HTMLDivElement | null>}
        isVideoLoading={false}
        isPlaying={false}
        videoLoadingStage='episodeChanging'
        videoLoadingAttempt={1}
        realtimeLoadSpeed=''
        authRecoveryVisible={false}
        authRecoveryReasonMessage=''
        onReloginAndRecover={jest.fn()}
        onDismissAuthRecovery={jest.fn()}
        onEpisodeChange={jest.fn()}
        onRetryPlayback={onRetryPlayback}
        onSourceChange={jest.fn()}
        currentSource='source-a'
        currentId='source-a-id'
        searchTitle='测试视频'
        availableSources={[detail]}
        sourceSearchLoading={false}
        sourceSearchError={null}
        precomputedVideoInfo={new Map()}
        videoYear='2026'
        favorited={false}
        onToggleFavorite={jest.fn()}
        videoCover=''
        videoDoubanId={0}
        playbackError='当前源加载失败'
      />,
    );

    expect(screen.getByText('当前源加载失败')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '继续尝试' }));

    expect(onRetryPlayback).toHaveBeenCalledTimes(1);
  });
});
