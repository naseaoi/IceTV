import {
  resolveSourceSwitchCurrentPlayTime,
  resolveSourceSwitchEpisodeAnchor,
  resolveSourceSwitchResumeState,
} from '@/features/play/lib/episodeResumePolicy';
import type { SearchResult } from '@/lib/types';

function createSearchResult(partial: Partial<SearchResult>): SearchResult {
  return {
    id: '1',
    title: 'test',
    poster: '',
    episodes: [],
    episodes_titles: [],
    source: 'source-a',
    source_name: 'Source A',
    year: '2026',
    ...partial,
  };
}

describe('episodeResumePolicy', () => {
  it('自动换源时优先采用播放器里的稳定进度', () => {
    expect(
      resolveSourceSwitchCurrentPlayTime({
        playerCurrentTime: 12.8,
        pendingResumeTime: 1320,
        stableCurrentTime: 10,
      }),
    ).toBe(12.8);
  });

  it('播放器进度只有零点几秒时回退到待恢复进度', () => {
    expect(
      resolveSourceSwitchCurrentPlayTime({
        playerCurrentTime: 0.4,
        pendingResumeTime: 1320,
        stableCurrentTime: 0,
      }),
    ).toBe(1320);
  });

  it('播放器和待恢复进度都无效时回退到 stableCurrentTime', () => {
    expect(
      resolveSourceSwitchCurrentPlayTime({
        playerCurrentTime: 0.2,
        pendingResumeTime: null,
        stableCurrentTime: 900,
      }),
    ).toBe(900);
  });

  it('三者都无效时返回 0', () => {
    expect(
      resolveSourceSwitchCurrentPlayTime({
        playerCurrentTime: 0,
        pendingResumeTime: null,
        stableCurrentTime: 0,
      }),
    ).toBe(0);
  });

  it('连续换源时会保留第一次换源的目标集锚点', () => {
    const sourceA = createSearchResult({
      source: 'source-a',
      episodes_titles: ['01', '02', '03', '04', '05', '06'],
    });
    const sourceB = createSearchResult({
      source: 'source-b',
      episodes_titles: ['第1集'],
    });

    const anchor = resolveSourceSwitchEpisodeAnchor({
      currentAnchor: null,
      activeDetail: sourceA,
      activeEpisodeIndex: 5,
    });

    expect(
      resolveSourceSwitchEpisodeAnchor({
        currentAnchor: anchor,
        activeDetail: sourceB,
        activeEpisodeIndex: 0,
      }),
    ).toEqual({
      detail: sourceA,
      episodeIndex: 5,
    });
  });

  it('旧 anchor 集数落后于当前 latest 时被 latest 矫正', () => {
    const sourceA = createSearchResult({
      source: 'source-a',
      episodes_titles: ['01', '02'],
    });
    const staleAnchor = {
      detail: sourceA,
      episodeIndex: 0,
    };

    expect(
      resolveSourceSwitchEpisodeAnchor({
        currentAnchor: staleAnchor,
        activeDetail: sourceA,
        activeEpisodeIndex: 13,
      }),
    ).toEqual({
      detail: sourceA,
      episodeIndex: 13,
    });
  });

  it('旧 anchor.detail 为 null 时用 activeDetail 兜底', () => {
    const sourceA = createSearchResult({ source: 'source-a' });
    const staleAnchor = {
      detail: null,
      episodeIndex: 10,
    };

    expect(
      resolveSourceSwitchEpisodeAnchor({
        currentAnchor: staleAnchor,
        activeDetail: sourceA,
        activeEpisodeIndex: 5,
      }),
    ).toEqual({
      detail: sourceA,
      episodeIndex: 10,
    });
  });

  it('切集后的自动换源不会继承上一集进度', () => {
    expect(
      resolveSourceSwitchResumeState({
        currentPlayTime: 1320,
        preserveProgress: true,
        clearTargetEpisodeProgress: true,
      }),
    ).toEqual({
      resumeTime: 0,
      resumeMode: 'forced',
    });
  });

  it('普通换源仍会保留当前集进度', () => {
    expect(
      resolveSourceSwitchResumeState({
        currentPlayTime: 1320,
        preserveProgress: true,
        clearTargetEpisodeProgress: false,
      }),
    ).toEqual({
      resumeTime: 1320,
      resumeMode: 'forced',
    });
  });

  it('无有效进度时会强制从目标集开头起播', () => {
    expect(
      resolveSourceSwitchResumeState({
        currentPlayTime: 1,
        preserveProgress: true,
        clearTargetEpisodeProgress: false,
      }),
    ).toEqual({
      resumeTime: 0,
      resumeMode: 'forced',
    });
  });
});
