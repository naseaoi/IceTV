import {
  extractEpisodeNumber,
  pickCandidateByEpisode,
} from '@/features/play/lib/danmaku/client';
import type { DanmakuMatchCandidate } from '@/features/play/lib/danmaku/types';

// 标题样本取自本地 danmu_api 实测响应
describe('extractEpisodeNumber', () => {
  it('优先匹配「第N集」', () => {
    expect(extractEpisodeNumber('【youku】 第1集 凡人修仙传 01')).toBe(1);
    expect(extractEpisodeNumber('【youku】 第30集 凡人修仙传 30')).toBe(30);
  });

  it('支持「第N话」与「第N期」', () => {
    expect(extractEpisodeNumber('【bilibili1】 第22话 魔道争锋1')).toBe(22);
    expect(extractEpisodeNumber('【mgtv】 第5期 综艺')).toBe(5);
  });

  it('不把来源标签里的数字当集号', () => {
    expect(extractEpisodeNumber('【bilibili1】 第22话 魔道争锋1')).not.toBe(1);
    expect(extractEpisodeNumber('【bilibili1】 第1集')).toBe(1);
  });

  it('没有序数词时回落到剔除标签后的首个数字', () => {
    expect(extractEpisodeNumber('【bilibili1】 EP07 标题')).toBe(7);
  });

  it('完全无数字时返回 null', () => {
    expect(extractEpisodeNumber('【youku】 正片')).toBeNull();
  });

  it('容忍序数词内的空格', () => {
    expect(extractEpisodeNumber('第 12 集')).toBe(12);
  });
});

describe('pickCandidateByEpisode', () => {
  const build = (titles: string[]): DanmakuMatchCandidate[] =>
    titles.map((episodeTitle, i) => ({
      episodeId: 1000 + i,
      animeTitle: '凡人修仙传',
      episodeTitle,
    }));

  it('按集号命中而非按顺序', () => {
    const candidates = build([
      '【youku】 第3集 凡人修仙传 03',
      '【youku】 第1集 凡人修仙传 01',
      '【youku】 第2集 凡人修仙传 02',
    ]);
    expect(pickCandidateByEpisode(candidates, 0)?.episodeTitle).toBe(
      '【youku】 第1集 凡人修仙传 01',
    );
    expect(pickCandidateByEpisode(candidates, 1)?.episodeTitle).toBe(
      '【youku】 第2集 凡人修仙传 02',
    );
  });

  it('集号缺失时按索引回落', () => {
    const candidates = build(['【youku】 正片', '【youku】 花絮']);
    expect(pickCandidateByEpisode(candidates, 1)?.episodeTitle).toBe(
      '【youku】 花絮',
    );
  });

  it('候选为空返回 null', () => {
    expect(pickCandidateByEpisode([], 0)).toBeNull();
  });

  it('索引越界返回 null', () => {
    expect(pickCandidateByEpisode(build(['【youku】 正片']), 5)).toBeNull();
  });

  it('不受来源标签数字干扰', () => {
    const candidates = build([
      '【bilibili1】 第22话 魔道争锋1',
      '【bilibili1】 第23话 魔道争锋2',
    ]);
    expect(pickCandidateByEpisode(candidates, 21)?.episodeTitle).toBe(
      '【bilibili1】 第22话 魔道争锋1',
    );
  });
});
