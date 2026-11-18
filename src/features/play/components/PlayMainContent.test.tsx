import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode, RefObject } from 'react';

import {
  buildLoadingTimeoutMessage,
  PlayMainContent,
} from '@/features/play/components/PlayMainContent';
import {
  beginVodStartupProgress,
  clearVodStartupProgress,
  getVodStartupProgress,
} from '@/features/play/lib/playerLoading';
import {
  createVodPlaybackIntent,
  getVodSourceAttempt,
} from '@/features/play/lib/vodPlaybackIntent';
import type { SearchResult } from '@/lib/types';

jest.mock('@/components/PlayerPageLayout', () => ({
  PlayerPageLayout: ({
    artRef,
    playerOverlay,
    rightPanel,
  }: {
    artRef: RefObject<HTMLDivElement | null>;
    playerOverlay: ReactNode;
    rightPanel: ReactNode;
  }) => (
    <>
      <div ref={artRef}>
        <video />
      </div>
      {playerOverlay}
      {rightPanel}
    </>
  ),
}));

function startMedia(sourceKey = '') {
  return beginVodStartupProgress(document.querySelector('video')!, sourceKey);
}

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
  default: ({ detailLoading }: { detailLoading: boolean }) => (
    <div data-detail-loading={detailLoading}>EpisodeSelector</div>
  ),
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
    detailLoading: false,
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
    onOpenSources: jest.fn(),
    openSourcesRequest: 0,
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
      '媒体加载已连续 20 秒无进展，源站响应超时',
    );
  });

  it('向详情面板传递详情加载状态', () => {
    render(<PlayMainContent {...createBaseProps()} detailLoading />);

    expect(screen.getByText('EpisodeSelector')).toHaveAttribute(
      'data-detail-loading',
      'true',
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

    startMedia();
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

    startMedia();
    act(() => {
      jest.advanceTimersByTime(PLAYER_LOADING_TIMEOUT_MS);
    });

    expect(screen.queryByText('切换剧集超时')).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(20_000);
    });

    expect(screen.getByText('切换剧集超时')).toBeInTheDocument();
    expect(
      screen.getByText('媒体加载已连续 35 秒无进展，源站响应超时'),
    ).toBeInTheDocument();
  });

  it('优源提示在父组件重渲染后仍按首次显示时间自动关闭', () => {
    const onDismissSourceRecommendation = jest.fn();
    const nextDismissSourceRecommendation = jest.fn();
    const sourceRecommendation = {
      source: 'source-b',
      id: 'source-b-id',
      title: '测试影片',
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

  it('优源提示可一键切换到推荐源', () => {
    const onSourceChange = jest.fn();
    const onDismissSourceRecommendation = jest.fn();

    render(
      <PlayMainContent
        {...createBaseProps()}
        onSourceChange={onSourceChange}
        sourceRecommendation={{
          source: 'source-b',
          id: 'source-b-id',
          title: '测试影片',
          sourceName: '源站B',
          quality: '1080P',
          loadSpeed: '1.2MB/s',
        }}
        onDismissSourceRecommendation={onDismissSourceRecommendation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '切换' }));

    expect(onSourceChange).toHaveBeenCalledWith(
      'source-b',
      'source-b-id',
      '测试影片',
    );
    expect(onDismissSourceRecommendation).toHaveBeenCalledTimes(1);
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

  it('播放器失败层可直接打开换源面板', () => {
    const onOpenSources = jest.fn();

    render(
      <PlayMainContent
        {...createBaseProps()}
        videoLoadingAttempt={1}
        onOpenSources={onOpenSources}
        playbackError='当前源加载失败'
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '选择其他源' }));

    expect(onOpenSources).toHaveBeenCalledTimes(1);
  });

  it('超时回调已接手（切线路或自动换源）时保持加载层', () => {
    const onLoadingTimeout = jest.fn(() => true);

    render(
      <PlayMainContent
        {...createBaseProps()}
        isVideoLoading
        videoLoadingStage='initing'
        onLoadingTimeout={onLoadingTimeout}
      />,
    );

    startMedia();
    act(() => {
      jest.advanceTimersByTime(PLAYER_LOADING_TIMEOUT_MS);
    });

    expect(onLoadingTimeout).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('加载视频超时')).not.toBeInTheDocument();
    expect(screen.getByText('正在加载视频')).toBeInTheDocument();
  });

  it('没有 attempt 的准备阶段按 W 兜底超时', () => {
    const onLoadingTimeout = jest.fn(() => false);
    render(
      <PlayMainContent
        {...createBaseProps()}
        isVideoLoading
        onLoadingTimeout={onLoadingTimeout}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(14_750);
    });
    expect(onLoadingTimeout).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(onLoadingTimeout).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText('媒体加载已连续 15 秒无进展，源站响应超时'),
    ).toBeInTheDocument();
  });

  it('未登记源尝试的准备耗时不回填媒体预算，媒体进展仍受总上限约束', () => {
    const onLoadingTimeout = jest.fn(() => false);
    render(
      <PlayMainContent
        {...createBaseProps()}
        isVideoLoading
        onLoadingTimeout={onLoadingTimeout}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(onLoadingTimeout).not.toHaveBeenCalled();
    const progress = startMedia('source-a');
    for (let i = 0; i < 5; i += 1) {
      act(() => {
        jest.advanceTimersByTime(10_000);
      });
      progress.lastProgressAt = performance.now();
    }
    expect(onLoadingTimeout).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(onLoadingTimeout).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText('媒体加载已达 60 秒，仍未能起播'),
    ).toBeInTheDocument();
  });

  it('页面轮询不把准备阶段起点写入后来创建的媒体 attempt', () => {
    const intent = createVodPlaybackIntent();
    const onLoadingTimeout = jest.fn(() => false);
    render(
      <PlayMainContent
        {...createBaseProps()}
        isVideoLoading
        playbackIntentRef={{ current: intent }}
        onLoadingTimeout={onLoadingTimeout}
      />,
    );
    act(() => jest.advanceTimersByTime(5_000));
    const attempt = getVodSourceAttempt(intent, 'source-a', 'a-id');
    act(() => jest.advanceTimersByTime(250));
    expect(attempt.startedAt).toBeNull();
    const progress = startMedia('source-a');
    attempt.startedAt = progress.startedAt;
    for (let i = 0; i < 5; i += 1) {
      act(() => jest.advanceTimersByTime(10_000));
      progress.lastProgressAt = performance.now();
    }
    act(() => jest.advanceTimersByTime(9_750));
    expect(onLoadingTimeout).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(250));
    expect(onLoadingTimeout).toHaveBeenCalledTimes(1);
  });

  it('运行时释放后旧进度不触发超时，回落后的新运行时独立计时', () => {
    const onLoadingTimeout = jest.fn(() => true);
    render(
      <PlayMainContent
        {...createBaseProps()}
        isVideoLoading
        onLoadingTimeout={onLoadingTimeout}
      />,
    );
    startMedia('source-a');
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    clearVodStartupProgress(document.querySelector('video')!);
    act(() => {
      jest.advanceTimersByTime(4_000);
    });
    expect(onLoadingTimeout).not.toHaveBeenCalled();
    startMedia('source-a');
    act(() => {
      jest.advanceTimersByTime(15_000);
    });
    expect(onLoadingTimeout).toHaveBeenCalledTimes(1);
    const progress = getVodStartupProgress(document.querySelector('video')!);
    startMedia('source-a');
    expect(getVodStartupProgress(document.querySelector('video')!)).not.toBe(
      progress,
    );
    act(() => {
      jest.advanceTimersByTime(15_000);
    });
    expect(onLoadingTimeout).toHaveBeenCalledTimes(2);
  });

  it('换集时上一集遗留的起播进度不计入新一轮加载', () => {
    const onLoadingTimeout = jest.fn(() => false);
    const props = { ...createBaseProps(), onLoadingTimeout };
    const { rerender } = render(<PlayMainContent {...props} isVideoLoading />);
    startMedia('source-a');
    rerender(<PlayMainContent {...props} isVideoLoading={false} />);
    act(() => {
      jest.advanceTimersByTime(20 * 60_000);
    });
    rerender(
      <PlayMainContent {...props} isVideoLoading videoLoadingAttempt={1} />,
    );
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(onLoadingTimeout).not.toHaveBeenCalled();
    expect(screen.queryByText('加载视频超时')).not.toBeInTheDocument();
    startMedia('source-a');
    act(() => {
      jest.advanceTimersByTime(PLAYER_LOADING_TIMEOUT_MS);
    });
    expect(onLoadingTimeout).toHaveBeenCalledTimes(1);
  });

  it('无进展窗口从最后一次真实进展计算', () => {
    const onLoadingTimeout = jest.fn(() => false);
    render(
      <PlayMainContent
        {...createBaseProps()}
        isVideoLoading
        onLoadingTimeout={onLoadingTimeout}
      />,
    );
    const progress = startMedia();
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    progress.lastProgressAt = performance.now();
    act(() => {
      jest.advanceTimersByTime(14_750);
    });
    expect(onLoadingTimeout).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(onLoadingTimeout).toHaveBeenCalledTimes(1);
  });

  it('为回落保留完整窗口，同源总预算封顶且新候选重新计时', () => {
    const intent = createVodPlaybackIntent();
    const attempt = getVodSourceAttempt(intent, 'source-a', 'a-id');
    attempt.startedAt = performance.now();
    attempt.allowAutoFallback = true;
    const onLoadingTimeout = jest.fn(() => {
      if (!attempt.routeSwitched) {
        attempt.routeSwitched = true;
        startMedia('source-a');
        return true;
      }
      return false;
    });
    const props = {
      ...createBaseProps(),
      isVideoLoading: true,
      onLoadingTimeout,
      playbackIntentRef: { current: intent },
    };
    const { rerender } = render(<PlayMainContent {...props} />);
    const progress = startMedia('source-a');
    for (let i = 0; i < 4; i += 1) {
      act(() => jest.advanceTimersByTime(10_000));
      progress.lastProgressAt = performance.now();
    }
    act(() => jest.advanceTimersByTime(5_000));
    expect(onLoadingTimeout).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(14_750));
    expect(onLoadingTimeout).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(250));
    expect(onLoadingTimeout).toHaveBeenCalledTimes(2);
    const candidate = getVodSourceAttempt(intent, 'source-b', 'b-id');
    candidate.startedAt = performance.now();
    candidate.allowAutoFallback = true;
    rerender(
      <PlayMainContent
        {...props}
        currentSource='source-b'
        videoLoadingAttempt={1}
      />,
    );
    startMedia('source-b');
    act(() => jest.advanceTimersByTime(14_750));
    expect(onLoadingTimeout).toHaveBeenCalledTimes(2);
    act(() => jest.advanceTimersByTime(250));
    expect(onLoadingTimeout).toHaveBeenCalledTimes(3);
  });

  it('成功起播后的故障从恢复起点计时，不继承旧媒体起播时间', () => {
    const intent = createVodPlaybackIntent();
    const attempt = getVodSourceAttempt(intent, 'source-a', 'a-id');
    attempt.startedAt = performance.now();
    const onLoadingTimeout = jest.fn(() => false);
    const props = {
      ...createBaseProps(),
      playbackIntentRef: { current: intent },
      onLoadingTimeout,
    };
    const { rerender } = render(<PlayMainContent {...props} isVideoLoading />);
    startMedia('source-a');
    attempt.startedAt = null;
    rerender(<PlayMainContent {...props} isVideoLoading={false} />);
    act(() => jest.advanceTimersByTime(300_000));
    rerender(
      <PlayMainContent {...props} isVideoLoading videoLoadingAttempt={1} />,
    );
    act(() => jest.advanceTimersByTime(14_750));
    expect(onLoadingTimeout).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(250));
    expect(onLoadingTimeout).toHaveBeenCalledTimes(1);
  });

  it('懒解析与媒体共用 T，准备阶段用 W 且不重置候选起点', () => {
    const intent = createVodPlaybackIntent();
    const attempt = getVodSourceAttempt(intent, 'source-a', 'a-id');
    attempt.startedAt = performance.now();
    const onLoadingTimeout = jest.fn(() => false);
    const props = {
      ...createBaseProps(),
      isVideoLoading: true,
      playbackIntentRef: { current: intent },
      onLoadingTimeout,
    };
    const { rerender } = render(<PlayMainContent {...props} />);
    act(() => jest.advanceTimersByTime(10_000));
    const progress = startMedia('source-a');
    rerender(<PlayMainContent {...props} videoLoadingAttempt={1} />);
    for (let i = 0; i < 4; i += 1) {
      act(() => jest.advanceTimersByTime(10_000));
      progress.lastProgressAt = performance.now();
    }
    act(() => jest.advanceTimersByTime(9_750));
    expect(onLoadingTimeout).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(250));
    expect(onLoadingTimeout).toHaveBeenCalledTimes(1);
    expect(attempt.startedAt).toBe(0);
  });

  it('回落恢复后关闭页面计时，缓冲不再增长也不换源', () => {
    const intent = createVodPlaybackIntent();
    const attempt = getVodSourceAttempt(intent, 'source-a', 'a-id');
    const onLoadingTimeout = jest.fn(() => false);
    const props = {
      ...createBaseProps(),
      playbackIntentRef: { current: intent },
      onLoadingTimeout,
    };
    const { rerender } = render(<PlayMainContent {...props} />);
    act(() => jest.advanceTimersByTime(300_000));
    attempt.startedAt = performance.now();
    attempt.routeSwitched = true;
    rerender(
      <PlayMainContent {...props} isVideoLoading videoLoadingAttempt={1} />,
    );
    startMedia('source-a');
    act(() => jest.advanceTimersByTime(5_000));
    attempt.startedAt = null;
    rerender(
      <PlayMainContent
        {...props}
        isVideoLoading={false}
        videoLoadingAttempt={1}
      />,
    );
    act(() => jest.advanceTimersByTime(120_000));
    expect(onLoadingTimeout).not.toHaveBeenCalled();
    expect(attempt.startedAt).toBeNull();
  });

  it('加载超时层支持继续尝试', () => {
    const onLoadingTimeout = jest.fn(() => false);
    const onRetryPlayback = jest.fn();

    render(
      <PlayMainContent
        {...createBaseProps()}
        isVideoLoading
        videoLoadingStage='initing'
        onLoadingTimeout={onLoadingTimeout}
        onRetryPlayback={onRetryPlayback}
      />,
    );

    startMedia();
    act(() => {
      jest.advanceTimersByTime(PLAYER_LOADING_TIMEOUT_MS);
    });

    expect(onLoadingTimeout).toHaveBeenCalledTimes(1);
    expect(screen.getByText('加载视频超时')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '继续尝试' }));

    expect(onRetryPlayback).toHaveBeenCalledTimes(1);
  });
});
