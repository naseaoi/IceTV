import artplayerPluginDanmuku from 'artplayer-plugin-danmuku';

import {
  applyOffset,
  createDanmakuPlugin,
  DANMAKU_HEATMAP_SAMPLING_PX,
  resolveDanmakuHeatmapOption,
} from '@/features/play/lib/danmaku/plugin';
import type { DanmakuItem } from '@/features/play/lib/danmaku/types';
import { type DisplayTextGlobals } from '@/lib/display-text';

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

describe('resolveDanmakuHeatmapOption', () => {
  it('开启时提供非零采样步长，避免窄容器触发无限循环', () => {
    expect(resolveDanmakuHeatmapOption(true)).toEqual({
      sampling: DANMAKU_HEATMAP_SAMPLING_PX,
    });
    expect(DANMAKU_HEATMAP_SAMPLING_PX).toBeGreaterThan(0);
  });

  it('关闭时不创建热力图', () => {
    expect(resolveDanmakuHeatmapOption(false)).toBe(false);
  });
});

jest.mock('artplayer-plugin-danmuku', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('弹幕显示边界', () => {
  const globals = globalThis as DisplayTextGlobals;
  afterEach(() => {
    document.documentElement.lang = '';
    delete globals.__ICETV_DISPLAY_CONVERTER__;
    jest.clearAllMocks();
  });

  it('转换队列副本并支持重复显示，加载和发送数据保留原文', async () => {
    document.documentElement.lang = 'zh-TW';
    // 非幂等转换可以发现 seek 后误把已显示文本再次转换的问题。
    globals.__ICETV_DISPLAY_CONVERTER__ = (text) => `${text}繁`;
    const items = [
      { text: '视频设置', time: 1, mode: 0 as const, color: '#FFFFFF' },
    ];
    const beforeEmit = jest.fn(async () => true);
    const loadItems = jest.fn(async () => items);
    await createDanmakuPlugin({
      loadItems,
      beforeEmit,
      opacity: 1,
      fontSize: 25,
      visible: true,
      heatmap: false,
    });
    const options = (artplayerPluginDanmuku as jest.Mock).mock.calls[0][0];
    expect(await options.danmuku()).toBe(items);
    const queued = { ...items[0] };
    expect(options.beforeVisible(queued)).toBe(true);
    expect(queued.text).toBe('视频设置繁');
    expect(options.beforeVisible(queued)).toBe(true);
    expect(queued.text).toBe('视频设置繁');
    expect(items[0].text).toBe('视频设置');
    const emitted = { text: '发送原文' };
    await options.beforeEmit(emitted);
    expect(beforeEmit).toHaveBeenCalledWith({ text: '发送原文' });
    expect(options.transformText('发送')).toBe('发送繁');
    expect(options.MARGIN.steps[3]).toEqual({
      name: '满屏繁',
      value: [10, 10],
    });
    expect(options.SPEED.steps[1]).toEqual({
      name: '较慢繁',
      value: 7.5,
      hide: true,
    });
  });

  it('简体队列文本保持不变', async () => {
    document.documentElement.lang = 'zh-CN';
    await createDanmakuPlugin({
      loadItems: async () => [],
      opacity: 1,
      fontSize: 25,
      visible: true,
      heatmap: false,
    });
    const options = (artplayerPluginDanmuku as jest.Mock).mock.calls[0][0];
    const item = { text: '视频设置' };
    expect(options.beforeVisible(item)).toBe(true);
    expect(item.text).toBe('视频设置');
  });
});
