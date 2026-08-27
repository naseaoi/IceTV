import {
  hasUsableEpisodeGroups,
  resolvePlayRecordEpisode,
} from '@/lib/episode-groups';
import type { EpisodeGroup } from '@/lib/types';

const GROUPS_11_11: EpisodeGroup[] = [
  { label: '繁中', count: 11 },
  { label: '简中', count: 11 },
];
const GROUPS_13_13: EpisodeGroup[] = [
  { label: '繁中', count: 13 },
  { label: '简中', count: 13 },
];

describe('hasUsableEpisodeGroups', () => {
  it('组集数之和与实际集数不一致时不可用', () => {
    expect(hasUsableEpisodeGroups(GROUPS_11_11, 22)).toBe(true);
    expect(hasUsableEpisodeGroups(GROUPS_11_11, 24)).toBe(false);
    expect(hasUsableEpisodeGroups([{ label: '繁中', count: 11 }], 11)).toBe(
      false,
    );
    expect(hasUsableEpisodeGroups(undefined, 11)).toBe(false);
  });
});

describe('resolvePlayRecordEpisode', () => {
  it('靠前分组新增剧集后按标签重新对齐绝对索引', () => {
    // 记录：简中第 10 集，旧结构下绝对索引 21（0-based 20）
    const resolved = resolvePlayRecordEpisode(
      {
        index: 21,
        group_index: 10,
        group_total: 11,
        group_label: '简中',
      },
      GROUPS_13_13,
      26,
    );

    // 繁中扩到 13 集后，简中第 10 集的绝对索引应为 13 + 9 = 22
    expect(resolved.episodeIndex).toBe(22);
    expect(resolved.groupLabel).toBe('简中');
    expect(resolved.groupIndex).toBe(10);
    expect(resolved.groupTotal).toBe(13);
    expect(resolved.trusted).toBe(true);
  });

  it('分组结构未变时保持原索引', () => {
    const resolved = resolvePlayRecordEpisode(
      { index: 21, group_index: 10, group_total: 11, group_label: '简中' },
      GROUPS_11_11,
      22,
    );

    expect(resolved.episodeIndex).toBe(20);
    expect(resolved.groupIndex).toBe(10);
    expect(resolved.trusted).toBe(true);
  });

  it('旧记录缺少标签且结构未变时可安全推断分组', () => {
    const resolved = resolvePlayRecordEpisode(
      { index: 21, group_index: 10, group_total: 11 },
      GROUPS_11_11,
      22,
    );

    expect(resolved.episodeIndex).toBe(20);
    expect(resolved.groupLabel).toBe('简中');
    expect(resolved.trusted).toBe(true);
  });

  it('旧记录缺少标签且结构已变时不猜测分组', () => {
    const resolved = resolvePlayRecordEpisode(
      { index: 21, group_index: 10, group_total: 11 },
      GROUPS_13_13,
      26,
    );

    expect(resolved.episodeIndex).toBe(20);
    expect(resolved.trusted).toBe(false);
  });

  it('非分组源沿用绝对索引并做边界收敛', () => {
    expect(
      resolvePlayRecordEpisode({ index: 10 }, undefined, 12).episodeIndex,
    ).toBe(9);
    expect(
      resolvePlayRecordEpisode({ index: 30 }, undefined, 12).episodeIndex,
    ).toBe(11);
    expect(
      resolvePlayRecordEpisode({ index: 0 }, undefined, 12).episodeIndex,
    ).toBe(0);
  });

  it('分组缩减时把组内位置收敛到该组最后一集', () => {
    const resolved = resolvePlayRecordEpisode(
      { index: 21, group_index: 10, group_total: 11, group_label: '简中' },
      [
        { label: '繁中', count: 5 },
        { label: '简中', count: 5 },
      ],
      10,
    );

    expect(resolved.episodeIndex).toBe(9);
    expect(resolved.groupIndex).toBe(5);
  });

  it('标签重复且结构已变时不猜测分组', () => {
    const resolved = resolvePlayRecordEpisode(
      { index: 12, group_index: 1, group_total: 11, group_label: '简中' },
      [
        { label: '简中', count: 13 },
        { label: '简中', count: 13 },
      ],
      26,
    );

    expect(resolved.trusted).toBe(false);
  });
});
