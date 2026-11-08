import {
  type DanmakuTopRequest,
  type VisibleDanmaku,
  resolveDanmakuTop,
} from '../lane';

const WIDTH = 1000;
const HEIGHT = 600;
const LINE = 28;
const SPEED = 200;

function request(
  overrides: Partial<Omit<DanmakuTopRequest, 'target'>> & {
    target?: Partial<DanmakuTopRequest['target']>;
  } = {},
): DanmakuTopRequest {
  return {
    visibles: [],
    clientWidth: WIDTH,
    clientHeight: HEIGHT,
    marginTop: 10,
    marginBottom: 150,
    antiOverlap: true,
    ...overrides,
    target: { mode: 0, height: LINE, speed: SPEED, ...overrides.target },
  };
}

// 滚动弹幕：left 为头部到播放器左边缘的距离
function scrolling(
  top: number,
  left: number,
  overrides: Partial<VisibleDanmaku> = {},
): VisibleDanmaku {
  const width = 100;
  const distance = left + width;
  return {
    mode: 0,
    top,
    height: LINE,
    width,
    distance,
    right: WIDTH - distance,
    speed: SPEED,
    time: distance / SPEED,
    ...overrides,
  };
}

function fixed(mode: 1 | 2, top: number): VisibleDanmaku {
  return {
    mode,
    top,
    height: LINE,
    width: 200,
    distance: 600,
    right: 400,
    speed: 0,
    time: 3,
  };
}

describe('resolveDanmakuTop', () => {
  it('没有在屏弹幕时滚动和顶部弹幕放在上边距处，底部弹幕贴底', () => {
    expect(resolveDanmakuTop(request())).toBe(10);
    expect(resolveDanmakuTop(request({ target: { mode: 1 } }))).toBe(10);
    expect(resolveDanmakuTop(request({ target: { mode: 2 } }))).toBe(
      HEIGHT - 150 - LINE,
    );
  });

  it('上一行弹幕尾部已腾出足够距离时复用该行，不再往下排', () => {
    const visibles = [scrolling(10, 400), scrolling(10 + LINE, 700)];
    expect(resolveDanmakuTop(request({ visibles }))).toBe(10);
  });

  it('上一行弹幕尾部还没进入画面或间距不足时换到下一行', () => {
    const visibles = [scrolling(10, 950), scrolling(10 + LINE, 880)];
    expect(resolveDanmakuTop(request({ visibles }))).toBe(10 + LINE * 2);
  });

  it('新弹幕更快且会在前一条离场前追上时不复用该行', () => {
    const visibles = [scrolling(10, 700, { speed: 50, time: 16 })];
    expect(resolveDanmakuTop(request({ visibles }))).toBe(10 + LINE);
  });

  it('上方行被腾出后优先回到上方', () => {
    const visibles = [scrolling(10 + LINE, 950), scrolling(10 + LINE * 2, 950)];
    expect(resolveDanmakuTop(request({ visibles }))).toBe(10);
  });

  it('只与同模式弹幕比较', () => {
    const visibles = [fixed(1, 10)];
    expect(resolveDanmakuTop(request({ visibles }))).toBe(10);
  });

  it('顶部弹幕不与同行静止弹幕共用一行，从上往下找空位', () => {
    const visibles = [fixed(1, 10), fixed(1, 10 + LINE)];
    expect(resolveDanmakuTop(request({ target: { mode: 1 }, visibles }))).toBe(
      10 + LINE * 2,
    );
  });

  it('底部弹幕从下往上找空位', () => {
    const bottom = HEIGHT - 150 - LINE;
    const visibles = [fixed(2, bottom)];
    expect(resolveDanmakuTop(request({ target: { mode: 2 }, visibles }))).toBe(
      bottom - LINE,
    );
  });

  it('区域占满时开启防重叠返回 undefined，关闭时选尾部空间最大的行', () => {
    const lines = Math.floor((HEIGHT - 150 - 10) / LINE);
    const visibles = Array.from({ length: lines }, (_, index) =>
      scrolling(10 + index * LINE, index === 3 ? 900 : 980),
    );
    expect(resolveDanmakuTop(request({ visibles }))).toBeUndefined();
    expect(resolveDanmakuTop(request({ visibles, antiOverlap: false }))).toBe(
      10 + LINE * 3,
    );
  });

  it('不把弹幕放到下边距以内', () => {
    const top = resolveDanmakuTop(
      request({ marginBottom: HEIGHT - 10 - LINE + 1 }),
    );
    expect(top).toBe(10);
    const lines = [scrolling(10, 990)];
    expect(
      resolveDanmakuTop(
        request({ visibles: lines, marginBottom: HEIGHT - 10 - LINE * 2 + 1 }),
      ),
    ).toBeUndefined();
  });
});
