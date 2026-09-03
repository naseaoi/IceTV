import { applyOffset } from '@/features/play/lib/danmaku/plugin';
import type { DanmakuItem } from '@/features/play/lib/danmaku/types';

const build = (times: number[]): DanmakuItem[] =>
  times.map((time, i) => ({
    text: `d${i}`,
    time,
    mode: 0,
    color: '#FFFFFF',
  }));

describe('applyOffset', () => {
  it('零偏移时把 time 为 0 的抬到正数', () => {
    const result = applyOffset(build([0, 12]), 0);
    expect(result[0].time).toBeGreaterThan(0);
    expect(result[1].time).toBe(12);
  });

  it('负偏移压到 0 的也抬到正数', () => {
    const result = applyOffset(build([5]), -5);
    expect(result).toHaveLength(1);
    expect(result[0].time).toBeGreaterThan(0);
  });

  it('正偏移整体延后', () => {
    expect(applyOffset(build([10, 20]), 3).map((i) => i.time)).toEqual([
      13, 23,
    ]);
  });

  it('偏移后为负的丢弃', () => {
    expect(applyOffset(build([1, 30]), -10).map((i) => i.time)).toEqual([20]);
  });

  it('不改动原数组', () => {
    const items = build([0, 10]);
    applyOffset(items, 5);
    expect(items.map((i) => i.time)).toEqual([0, 10]);
  });
});
