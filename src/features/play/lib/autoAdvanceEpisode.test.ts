import {
  isTrustworthyPlaybackEnd,
  shouldAutoAdvanceEpisode,
} from '@/features/play/lib/autoAdvanceEpisode';

const READY_STATE = {
  enabled: true,
  armed: true,
  alreadyAdvanced: false,
  currentEpisodeIndex: 2,
  episodeCount: 4,
};

describe('shouldAutoAdvanceEpisode', () => {
  it('允许已就绪且存在下一集的自动连播', () => {
    expect(shouldAutoAdvanceEpisode(READY_STATE)).toBe(true);
  });

  it.each([
    ['自动连播关闭', { enabled: false }],
    ['自动连播未就绪', { armed: false }],
    ['当前集已触发过连播', { alreadyAdvanced: true }],
    ['当前集是最后一集', { currentEpisodeIndex: 3 }],
    ['当前集索引无效', { currentEpisodeIndex: -1 }],
  ])('%s 时不切换下一集', (_, overrides) => {
    expect(
      shouldAutoAdvanceEpisode({
        ...READY_STATE,
        ...overrides,
      }),
    ).toBe(false);
  });
});

describe('isTrustworthyPlaybackEnd', () => {
  it('接近片尾的 ended 视为正常播完', () => {
    expect(isTrustworthyPlaybackEnd(1548, 1548.63)).toBe(true);
    expect(isTrustworthyPlaybackEnd(1460, 1548.63)).toBe(true);
  });

  it('距离片尾过远的 ended 判为 MSE 异常', () => {
    expect(isTrustworthyPlaybackEnd(839, 1548.63)).toBe(false);
  });

  it('拿不到清单时长时不拦截', () => {
    expect(isTrustworthyPlaybackEnd(839, null)).toBe(true);
    expect(isTrustworthyPlaybackEnd(839, 0)).toBe(true);
    expect(isTrustworthyPlaybackEnd(839, Infinity)).toBe(true);
  });

  it('短视频用固定 90s 兜底，不因比例过小误拦', () => {
    expect(isTrustworthyPlaybackEnd(30, 100)).toBe(true);
  });
});
