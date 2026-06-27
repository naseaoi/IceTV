import {
  hasReachedResumeTarget,
  markPlayerLoadingSessionStarted,
  resetPlayerLoadingSessionState,
  shouldDismissLoadingFromCanPlay,
  shouldDismissLoadingFromReadyFrame,
} from '@/features/play/lib/playerLoading';

describe('playerLoading', () => {
  it('视频仍处于暂停态时，canplay 不能提前关闭加载遮罩', () => {
    expect(
      shouldDismissLoadingFromCanPlay({ paused: true, ended: false }),
    ).toBe(false);
  });

  it('只有视频已经进入实际播放态时，canplay 才能兜底关闭遮罩', () => {
    expect(
      shouldDismissLoadingFromCanPlay({ paused: false, ended: false }),
    ).toBe(true);
  });

  it('首帧已解码且当前位置有缓存时，可以关闭加载遮罩', () => {
    const video = {
      readyState: 4,
      videoWidth: 1920,
      currentTime: 0,
      ended: false,
      buffered: {
        length: 1,
        start: () => 0.023,
        end: () => 121,
      },
    };

    expect(shouldDismissLoadingFromReadyFrame(video)).toBe(true);
  });

  it('只有元数据或没有有效缓存时，不关闭加载遮罩', () => {
    const video = {
      readyState: 1,
      videoWidth: 0,
      currentTime: 0,
      ended: false,
      buffered: {
        length: 0,
        start: () => 0,
        end: () => 0,
      },
    };

    expect(shouldDismissLoadingFromReadyFrame(video)).toBe(false);
  });

  it('恢复进度达到目标附近后即可关闭遮罩', () => {
    expect(hasReachedResumeTarget(299.4, 300)).toBe(true);
    expect(hasReachedResumeTarget(120, 300)).toBe(false);
  });

  it('新一轮切集加载会重置关闭遮罩的会话状态', () => {
    const state = {
      pendingInitialResumeTarget: 180,
      playbackStartNotified: true,
    };

    resetPlayerLoadingSessionState(state);

    expect(state.pendingInitialResumeTarget).toBeNull();
    expect(markPlayerLoadingSessionStarted(state)).toBe(true);
    expect(markPlayerLoadingSessionStarted(state)).toBe(false);
  });
});
