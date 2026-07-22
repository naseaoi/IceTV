import { shouldAutoAdvanceEpisode } from '@/features/play/lib/autoAdvanceEpisode';

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
