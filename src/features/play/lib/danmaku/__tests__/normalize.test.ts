import {
  downsampleByTime,
  normalizeComment,
  normalizeComments,
  toArtplayerMode,
  toCssColor,
} from '@/features/play/lib/danmaku/normalize';

describe('toArtplayerMode', () => {
  it('把 dandanplay 滚动类型映射为 0', () => {
    expect(toArtplayerMode(1)).toBe(0);
    expect(toArtplayerMode(2)).toBe(0);
    expect(toArtplayerMode(3)).toBe(0);
  });

  it('把顶部 5 映射为 1、底部 4 映射为 2', () => {
    expect(toArtplayerMode(5)).toBe(1);
    expect(toArtplayerMode(4)).toBe(2);
  });

  it('接受字符串形式的类型', () => {
    expect(toArtplayerMode('5')).toBe(1);
    expect(toArtplayerMode('4')).toBe(2);
  });

  it('无法解析时回落为滚动', () => {
    expect(toArtplayerMode('abc')).toBe(0);
    expect(toArtplayerMode(undefined)).toBe(0);
    expect(toArtplayerMode(99)).toBe(0);
  });
});

describe('toCssColor', () => {
  it('把十进制颜色转为六位十六进制', () => {
    expect(toCssColor(16777215)).toBe('#FFFFFF');
    expect(toCssColor(16711680)).toBe('#FF0000');
    expect(toCssColor('255')).toBe('#0000FF');
  });

  it('低位颜色补齐到六位', () => {
    expect(toCssColor(1)).toBe('#000001');
  });

  it('越界或非法值回落为白色', () => {
    expect(toCssColor(-1)).toBe('#FFFFFF');
    expect(toCssColor(16777216)).toBe('#FFFFFF');
    expect(toCssColor('xyz')).toBe('#FFFFFF');
  });
});

describe('normalizeComment', () => {
  it('解析 4 字段 p：颜色取第 3 位', () => {
    expect(
      normalizeComment({ p: '12.5,1,16711680,[bilibili]', m: '滚动弹幕' }),
    ).toEqual({
      text: '滚动弹幕',
      time: 12.5,
      mode: 0,
      color: '#FF0000',
    });
  });

  it('解析 8 字段 p：颜色取第 4 位', () => {
    expect(
      normalizeComment({
        p: '5.0,5,25,16488046,1751533608,0,0,13190629936',
        m: '顶部弹幕',
      }),
    ).toEqual({
      text: '顶部弹幕',
      time: 5,
      mode: 1,
      color: '#FB966E',
    });
  });

  it('解析 9 字段 p（B站带权重）', () => {
    const result = normalizeComment({
      p: '8.0,4,25,255,1751533608,0,0,13190629936,10',
      m: '底部弹幕',
    });
    expect(result?.mode).toBe(2);
    expect(result?.color).toBe('#0000FF');
  });

  it('支持已归一化的对象形式', () => {
    expect(
      normalizeComment({ text: '直传', time: 3, mode: 5, color: 255 }),
    ).toEqual({ text: '直传', time: 3, mode: 1, color: '#0000FF' });
  });

  it('丢弃空文本与非法时间', () => {
    expect(normalizeComment({ p: '1,1,255,[x]', m: '   ' })).toBeNull();
    expect(normalizeComment({ p: 'abc,1,255,[x]', m: '有文本' })).toBeNull();
    expect(normalizeComment({ p: '-1,1,255,[x]', m: '负时间' })).toBeNull();
  });

  it('p 字段不足 3 段时丢弃', () => {
    expect(normalizeComment({ p: '1,1', m: '残缺' })).toBeNull();
  });

  it('把控制字符替换为空格', () => {
    const raw = ['前', String.fromCharCode(10), '后'].join('');
    expect(normalizeComment({ p: '1,1,255,[x]', m: raw })?.text).toBe('前 后');
  });
});

describe('downsampleByTime', () => {
  const build = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      text: `d${i}`,
      time: i,
      mode: 0 as const,
      color: '#FFFFFF',
    }));

  it('未超上限时原样返回', () => {
    const items = build(10);
    expect(downsampleByTime(items, 20)).toBe(items);
  });

  it('超上限时抽稀到目标条数', () => {
    expect(downsampleByTime(build(100), 10)).toHaveLength(10);
  });

  it('抽稀后仍覆盖首尾时间段', () => {
    const sampled = downsampleByTime(build(100), 10);
    expect(sampled[0].time).toBe(0);
    expect(sampled[sampled.length - 1].time).toBeGreaterThan(80);
  });
});

describe('normalizeComments', () => {
  it('按时间升序排列', () => {
    const result = normalizeComments(
      [
        { p: '30,1,255,[x]', m: '后' },
        { p: '10,1,255,[x]', m: '前' },
      ],
      1000,
    );
    expect(result.items.map((item) => item.text)).toEqual(['前', '后']);
  });

  it('统计原始总量并标记抽稀', () => {
    const raw = Array.from({ length: 50 }, (_, i) => ({
      p: `${i},1,255,[x]`,
      m: `d${i}`,
    }));
    const result = normalizeComments(raw, 10);
    expect(result.total).toBe(50);
    expect(result.items).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it('未抽稀时 truncated 为 false', () => {
    const result = normalizeComments([{ p: '1,1,255,[x]', m: 'a' }], 10);
    expect(result.truncated).toBe(false);
  });

  it('非数组输入返回空结果', () => {
    expect(normalizeComments(null, 10)).toEqual({
      items: [],
      total: 0,
      truncated: false,
    });
  });

  it('跳过非对象条目', () => {
    const result = normalizeComments(
      ['bad', null, { p: '1,1,255,[x]', m: 'ok' }],
      10,
    );
    expect(result.items).toHaveLength(1);
  });
});
