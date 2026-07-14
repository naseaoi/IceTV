import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode, RefObject } from 'react';

import {
  buildLoadingTimeoutMessage,
  PlayMainContent,
} from '@/features/play/components/PlayMainContent';
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
  default: ({
    title,
    message,
    children,
  }: {
    title: string;
    message?: string;
    children: ReactNode;
  }) => (
    <div>
      <div>{title}</div>
      {message ? <div>{message}</div> : null}
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

  const createBaseProps = (): ComponentProps<typeof PlayMainContent> => ({
    videoTitle: '测试视频',
    totalEpisodes: 1,
    detail,
    currentEpisodeIndex: 0,
    isEpisodeSelectorCollapsed: false,
    setIsEpisodeSelectorCollapsed: jest.fn(),
    artRef: { current: null } as RefObject<HTMLDivElement | null>,
    isVideoLoading: false,
    videoLoadingStage: 'episodeChanging',
    videoLoadingAttempt: 0,
    realtimeLoadSpeed: '',
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
  });

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

  it('uses the configured timeout seconds in loading timeout copy', () => {
    expect(buildLoadingTimeoutMessage(20)).toBe(
      '已等待超过 20 秒，源站响应超时',
    );
  });

  it('在新的换源轮次开始后重置超时提示', () => {
    const baseProps = {
      ...createBaseProps(),
      isVideoLoading: true,
      videoLoadingStage: 'sourceChanging' as const,
      videoLoadingAttempt: 0,
      realtimeLoadSpeed: '测速中...',
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

  it('uses the extended loading timeout for xigua', () => {
    render(
      <PlayMainContent
        {...createBaseProps()}
        currentSource='xigua'
        isVideoLoading
        videoLoadingStage='episodeChanging'
      />,
    );

    act(() => {
      jest.advanceTimersByTime(PLAYER_LOADING_TIMEOUT_MS);
    });

    expect(screen.queryByText('切换剧集超时')).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(20_000);
    });

    expect(screen.getByText('切换剧集超时')).toBeInTheDocument();
    expect(
      screen.getByText('已等待超过 35 秒，源站响应超时'),
    ).toBeInTheDocument();
  });

  it('优源提示在父组件重渲染后仍按首次显示时间自动关闭', () => {
    const onDismissSourceRecommendation = jest.fn();
    const nextDismissSourceRecommendation = jest.fn();
    const sourceRecommendation = {
      source: 'source-b',
      sourceName: '源站B',
      quality: '1080P',
      loadSpeed: '1.2MB/s',
    };

    const { rerender } = render(
      <PlayMainContent
        {...createBaseProps()}
        sourceRecommendation={sourceRecommendation}
        onDismissSourceRecommendation={onDismissSourceRecommendation}
      />,
    );

    expect(screen.getByText('发现更优源：源站B')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    rerender(
      <PlayMainContent
        {...createBaseProps()}
        sourceRecommendation={sourceRecommendation}
        onDismissSourceRecommendation={nextDismissSourceRecommendation}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(2999);
    });

    expect(onDismissSourceRecommendation).not.toHaveBeenCalled();
    expect(nextDismissSourceRecommendation).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(onDismissSourceRecommendation).not.toHaveBeenCalled();
    expect(nextDismissSourceRecommendation).toHaveBeenCalledTimes(1);
  });

  it('在播放器失败层支持继续尝试', () => {
    const onRetryPlayback = jest.fn();

    render(
      <PlayMainContent
        {...createBaseProps()}
        videoLoadingAttempt={1}
        onRetryPlayback={onRetryPlayback}
        playbackError='当前源加载失败'
      />,
    );

    expect(screen.getByText('当前源加载失败')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '继续尝试' }));

    expect(onRetryPlayback).toHaveBeenCalledTimes(1);
  });
});
