import {
  consumeMatchingPlayIntent,
  PLAY_INTENT_KEY,
  savePlayIntent,
} from '@/lib/play-intent';

describe('playIntent', () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.restoreAllMocks();
  });

  it('保存后会按 forced 恢复并在消费后清理', () => {
    savePlayIntent({
      source: 'source-a',
      id: 'id-a',
      episodeIndex: 7,
      resumeTime: 180.8,
    });

    expect(
      consumeMatchingPlayIntent({
        source: 'source-a',
        id: 'id-a',
        episodeCount: 12,
      }),
    ).toEqual({
      episodeIndex: 7,
      resumeTime: 180,
      resumeMode: 'forced',
    });
    expect(sessionStorage.getItem(PLAY_INTENT_KEY)).toBeNull();
  });

  it('只在 source/id 匹配时消费播放意图', () => {
    savePlayIntent({
      source: 'source-a',
      id: 'id-a',
      episodeIndex: 7,
      resumeTime: 180,
    });

    expect(
      consumeMatchingPlayIntent({
        source: 'source-b',
        id: 'id-a',
        episodeCount: 12,
      }),
    ).toBeNull();
    expect(sessionStorage.getItem(PLAY_INTENT_KEY)).not.toBeNull();
  });

  it('播放意图过期后会自动丢弃', () => {
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
    savePlayIntent({
      source: 'source-a',
      id: 'id-a',
      episodeIndex: 7,
      resumeTime: 180,
    });

    jest.spyOn(Date, 'now').mockReturnValue(10_000 + 5 * 60 * 1000 + 1);

    expect(
      consumeMatchingPlayIntent({
        source: 'source-a',
        id: 'id-a',
        episodeCount: 12,
      }),
    ).toBeNull();
    expect(sessionStorage.getItem(PLAY_INTENT_KEY)).toBeNull();
  });

  it('恢复集数会被裁剪到当前可播放范围', () => {
    savePlayIntent({
      source: 'source-a',
      id: 'id-a',
      episodeIndex: 99,
      resumeTime: 180,
    });

    expect(
      consumeMatchingPlayIntent({
        source: 'source-a',
        id: 'id-a',
        episodeCount: 12,
      }),
    ).toEqual({
      episodeIndex: 11,
      resumeTime: 180,
      resumeMode: 'forced',
    });
  });

  it('resumeTime 为 0 时仍会保留目标集意图', () => {
    savePlayIntent({
      source: 'source-a',
      id: 'id-a',
      episodeIndex: 10,
      resumeTime: 0,
    });

    expect(
      consumeMatchingPlayIntent({
        source: 'source-a',
        id: 'id-a',
        episodeCount: 12,
      }),
    ).toEqual({
      episodeIndex: 10,
      resumeTime: 0,
      resumeMode: null,
    });
  });

  it('分组源上游新增剧集后按分组标签重新对齐目标集', () => {
    savePlayIntent({
      source: 'source-a',
      id: 'id-a',
      episodeIndex: 20,
      resumeTime: 180,
      groupLabel: '简中',
      groupIndex: 10,
      groupTotal: 11,
    });

    expect(
      consumeMatchingPlayIntent({
        source: 'source-a',
        id: 'id-a',
        episodeCount: 26,
        episodeGroups: [
          { label: '繁中', count: 13 },
          { label: '简中', count: 13 },
        ],
      }),
    ).toEqual({
      episodeIndex: 22,
      resumeTime: 180,
      resumeMode: 'forced',
    });
  });
});
