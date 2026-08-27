import { buildRefreshedPlayRecord } from '@/lib/cron/metadata-refresh';
import type { PlayRecord, SearchResult } from '@/lib/types';

function createRecord(overrides: Partial<PlayRecord> = {}): PlayRecord {
  return {
    title: '测试番剧',
    source_name: '测试源',
    cover: 'cover.jpg',
    year: '2026',
    index: 21,
    total_episodes: 22,
    group_index: 10,
    group_total: 11,
    group_label: '简中',
    play_time: 600,
    total_time: 1440,
    save_time: 1000,
    ...overrides,
  };
}

function createDetail(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: '1',
    title: '测试番剧',
    poster: 'cover.jpg',
    episodes: Array.from({ length: 26 }, (_, index) => `ep-${index}`),
    episodes_titles: [],
    source: 'source',
    source_name: '测试源',
    class: '',
    year: '2026',
    desc: '',
    type_name: '动漫',
    douban_id: 0,
    episode_groups: [
      { label: '繁中', count: 13 },
      { label: '简中', count: 13 },
    ],
    ...overrides,
  };
}

describe('buildRefreshedPlayRecord', () => {
  it('靠前分组新增剧集后修正绝对索引并标记更新', () => {
    const next = buildRefreshedPlayRecord(createRecord(), createDetail(), 5000);

    // 简中第 10 集：繁中扩到 13 集后绝对索引应为 13 + 9 = 22 → index 23
    expect(next.index).toBe(23);
    expect(next.group_index).toBe(10);
    expect(next.group_total).toBe(13);
    expect(next.group_label).toBe('简中');
    expect(next.total_episodes).toBe(26);
    expect(next.update_detected_at).toBe(5000);
    expect(next.update_baseline_group_total).toBe(11);
  });

  it('无更新时不写入 update_detected_at', () => {
    const next = buildRefreshedPlayRecord(
      createRecord(),
      createDetail({
        episodes: Array.from({ length: 22 }, (_, index) => `ep-${index}`),
        episode_groups: [
          { label: '繁中', count: 11 },
          { label: '简中', count: 11 },
        ],
      }),
      5000,
    );

    expect(next.index).toBe(21);
    expect(next.group_total).toBe(11);
    expect(next.update_detected_at).toBeUndefined();
  });

  it('详情缺失时只更新检查时间并补齐基线', () => {
    const next = buildRefreshedPlayRecord(createRecord(), null, 5000);

    expect(next.metadata_checked_at).toBe(5000);
    expect(next.index).toBe(21);
    expect(next.total_episodes).toBe(22);
    expect(next.update_baseline_group_total).toBe(11);
    expect(next.update_baseline_episodes).toBe(22);
  });

  it('非分组源按总集数判断更新', () => {
    const next = buildRefreshedPlayRecord(
      createRecord({
        index: 10,
        total_episodes: 11,
        group_index: undefined,
        group_total: undefined,
        group_label: undefined,
      }),
      createDetail({
        episodes: Array.from({ length: 12 }, (_, index) => `ep-${index}`),
        episode_groups: undefined,
      }),
      5000,
    );

    expect(next.index).toBe(10);
    expect(next.total_episodes).toBe(12);
    expect(next.update_detected_at).toBe(5000);
    expect(next.update_baseline_episodes).toBe(11);
  });
});
