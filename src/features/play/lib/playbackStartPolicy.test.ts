import type { SearchResult } from '@/lib/types';

import { isPlaybackFinished } from './episodeProgress';
import {
  decidePlaybackStart,
  getNextPlaybackEpisode,
  resolveEpisodeSwitchResumeTime,
} from './playbackStartPolicy';

function detail(count: number, grouped = false): SearchResult {
  return {
    id: 'id',
    source: 'src',
    source_name: '源',
    title: '剧',
    year: '',
    poster: '',
    episodes: Array.from({ length: count }, (_, i) => `${i}`),
    episodes_titles: [],
    ...(grouped
      ? {
          episode_groups: [
            { label: '甲', count: 2 },
            { label: '乙', count: 2 },
          ],
        }
      : {}),
  };
}

describe('统一看完与位置规则', () => {
  const skipConfig = { enable: true, intro_time: 60, outro_time: -90 };
  it.each([
    [1194, 1200, false, false],
    [1195, 1200, false, true],
    [1110, 1200, true, true],
    [1109, 1200, true, false],
    [1110, 1200, false, false],
    [1110, 0, true, false],
  ])('位置 %s / 时长 %s / 片尾 %s', (time, duration, enable, finished) => {
    expect(isPlaybackFinished(time, duration, { ...skipConfig, enable })).toBe(
      finished,
    );
  });

  it.each([false, true])('片尾点参与起播决策，连播 %s', (autoPlayNext) => {
    expect(
      decidePlaybackStart({
        target: { episodeIndex: 0, resumeTime: 1110, recordDuration: 1200 },
        detail: detail(2),
        autoPlayNext,
        skipConfig,
      }),
    ).toMatchObject(
      autoPlayNext
        ? { kind: 'play', episodeIndex: 1, resumeTime: 0 }
        : { kind: 'park', episodeIndex: 0, resumeTime: 1110 },
    );
  });

  it.each([
    [0, undefined, 0],
    [0, 600, 600],
    [0, 1110, 0],
    [456, 1110, 456],
  ])('切集继承 %s / 记录 %s → %s', (crossGroupResumeTime, time, expected) => {
    expect(
      resolveEpisodeSwitchResumeTime({
        crossGroupResumeTime,
        entry:
          time === undefined
            ? undefined
            : { k: 'n:1', t: time, d: 1200, at: 1 },
        skipConfig,
      }),
    ).toBe(expected);
  });
});

describe('起播决策矩阵', () => {
  for (const autoPlayNext of [false, true]) {
    for (const hasNext of [false, true]) {
      for (const finished of [false, true]) {
        for (const durationKnown of [false, true]) {
          it(`${autoPlayNext ? '开' : '关'}连播 / ${hasNext ? '有' : '无'}下一集 / ${finished ? '看完' : '未完'} / ${durationKnown ? '已知' : '未知'}时长`, () => {
            const target = {
              episodeIndex: 0,
              resumeTime: finished ? 1198 : 1190,
              recordDuration: durationKnown ? 1200 : undefined,
            };
            const options = {
              target,
              detail: detail(hasNext ? 2 : 1),
              autoPlayNext,
              nextResumeTime: 300,
            };
            const initial = decidePlaybackStart(options);
            if (!durationKnown)
              expect(initial).toMatchObject({
                kind: 'play',
                needsDuration: true,
                resumeTime: target.resumeTime,
              });
            const result = decidePlaybackStart({
              ...options,
              actualDuration: 1200,
            });
            if (!finished)
              expect(result).toMatchObject({
                kind: 'play',
                episodeIndex: 0,
                resumeTime: 1190,
              });
            else if (autoPlayNext && hasNext)
              expect(result).toMatchObject({
                kind: 'play',
                episodeIndex: 1,
                resumeTime: 300,
              });
            else
              expect(result).toEqual({
                kind: 'park',
                episodeIndex: 0,
                resumeTime: 1198,
              });
          });
        }
      }
    }
  }

  it.each([false, true])('记录时长优先于实际时长，连播 %s', (autoPlayNext) => {
    expect(
      decidePlaybackStart({
        target: { episodeIndex: 0, resumeTime: 1180, recordDuration: 1200 },
        detail: detail(2),
        autoPlayNext,
        actualDuration: 1180,
      }),
    ).toMatchObject({ kind: 'play', episodeIndex: 0, resumeTime: 1180 });
  });

  it.each([false, true])('过期详情只在连播开启时等待：%s', (autoPlayNext) => {
    const options = {
      target: {
        episodeIndex: 6,
        resumeTime: 1198,
        recordDuration: 1200,
        knownEpisodeCount: 28,
      },
      detail: detail(7),
      autoPlayNext,
      refreshing: true,
    };
    expect(decidePlaybackStart(options).kind).toBe(
      autoPlayNext ? 'wait' : 'park',
    );
    expect(decidePlaybackStart({ ...options, waitExpired: true }).kind).toBe(
      'park',
    );
    expect(decidePlaybackStart({ ...options, refreshing: false }).kind).toBe(
      'park',
    );
    expect(
      decidePlaybackStart({ ...options, detail: detail(28), refreshing: false })
        .kind,
    ).toBe(autoPlayNext ? 'play' : 'park');
  });

  it('过期详情里已有下一集时直接推进，不等刷新', () => {
    expect(
      decidePlaybackStart({
        target: {
          episodeIndex: 4,
          resumeTime: 1198,
          recordDuration: 1200,
          knownEpisodeCount: 28,
        },
        detail: detail(7),
        autoPlayNext: true,
        refreshing: true,
      }),
    ).toMatchObject({ kind: 'play', episodeIndex: 5 });
  });

  it('分组源只在组内判断下一集与已知集数', () => {
    const grouped = detail(4, true);
    expect(getNextPlaybackEpisode(grouped, 1)).toBeNull();
    expect(getNextPlaybackEpisode(grouped, 2)).toBe(3);
    const options = {
      target: {
        episodeIndex: 1,
        resumeTime: 1198,
        recordDuration: 1200,
        knownEpisodeCount: 3,
      },
      detail: grouped,
      autoPlayNext: true,
      refreshing: true,
    };
    expect(decidePlaybackStart(options).kind).toBe('wait');
    expect(decidePlaybackStart({ ...options, waitExpired: true }).kind).toBe(
      'park',
    );
  });
});
