import {
  type PlaybackSmoothnessEvent,
  type PlaybackSmoothnessSnapshot,
  createPlaybackSmoothnessMeter,
} from './playbackSmoothnessMeter';

function setup() {
  let now = 0;
  const sample: PlaybackSmoothnessSnapshot = {
    currentTime: 0,
    forwardBuffer: 0,
    paused: false,
    visible: true,
    online: true,
    seeking: false,
    resourceWaiting: false,
  };
  const meter = createPlaybackSmoothnessMeter(() => now);
  const send = (
    ms: number,
    event: PlaybackSmoothnessEvent = 'tick',
    patch: Partial<PlaybackSmoothnessSnapshot> = {},
  ) => {
    now += ms;
    Object.assign(sample, patch);
    meter.update(event, { ...sample });
  };
  const start = () => {
    send(0, 'playing');
    send(100, 'timeupdate', { currentTime: 0.1 });
  };
  return {
    meter,
    send,
    start,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

it('首次 playing 后真实推进才开始，起播等待和倍速不放大观看时长', () => {
  const { meter, send } = setup();
  send(10_000, 'waiting');
  send(2_000);
  send(0, 'playing');
  send(2_000);
  expect(meter.getTotals()).toEqual({
    watchMs: 0,
    stallCount: 0,
    stallMs: 0,
    unknownMs: 0,
  });
  send(100, 'timeupdate', { currentTime: 0.1 });
  send(1_000, 'timeupdate', { currentTime: 3.1 });
  expect(meter.getTotals().watchMs).toBe(1_000);
});

it('等待满一秒且前向缓冲不足才确认，时长追溯到等待开始', () => {
  const { meter, send, start } = setup();
  start();
  send(1_000, 'waiting', { currentTime: 1.1 });
  send(999);
  expect(meter.getTotals().stallCount).toBe(0);
  send(1);
  expect(meter.getTotals()).toMatchObject({
    watchMs: 1_000,
    stallCount: 1,
    stallMs: 1_000,
  });
  send(2_000, 'timeupdate', { currentTime: 1.2 });
  expect(meter.getTotals().stallMs).toBe(3_000);
  send(1_000, 'timeupdate', { currentTime: 2.2 });
  expect(meter.getTotals().watchMs).toBe(2_000);
});

it('缓冲按确认时读取，充足时只计 unknown', () => {
  const { meter, send, start } = setup();
  start();
  send(0, 'waiting');
  send(1_000, 'tick', { forwardBuffer: 1 });
  send(1_000, 'timeupdate', { currentTime: 0.2 });
  expect(meter.getTotals()).toMatchObject({
    unknownMs: 2_000,
    stallCount: 0,
    stallMs: 0,
  });
});

it('微小时间抖动仍按等待开始位置确认，真实推进取消未确认等待', () => {
  const { meter, send, start } = setup();
  start();
  send(0, 'waiting');
  send(500, 'timeupdate', { currentTime: 0.12 });
  send(500, 'timeupdate', { currentTime: 0.14 });
  expect(meter.getTotals().stallCount).toBe(1);
  send(1, 'timeupdate', { currentTime: 0.2 });
  send(2_000, 'waiting');
  send(500, 'timeupdate', { currentTime: 0.3 });
  expect(meter.getTotals().stallCount).toBe(1);
});

it.each(['seeking', 'seeked'] as const)(
  '%s 与其后三秒排除（程序和用户 seek 同口径）',
  (event) => {
    const { meter, send, start } = setup();
    start();
    send(0, event, { currentTime: 30 });
    send(1_000, 'waiting');
    send(1_999);
    expect(meter.getTotals()).toMatchObject({ watchMs: 0, stallCount: 0 });
    send(1, 'timeupdate', { currentTime: 30.1 });
    send(1_000, 'waiting', { currentTime: 31.1 });
    send(1_000);
    expect(meter.getTotals()).toMatchObject({ watchMs: 1_000, stallCount: 1 });
  },
);

it('起播续播 seek 宽限期内的 playing 保留资格，三秒后真实推进正常计量', () => {
  const { meter, send } = setup();
  send(0, 'seeking', { seeking: true, currentTime: 60 });
  send(0, 'seeked', { seeking: false });
  send(0, 'playing');
  send(2_000, 'timeupdate', { currentTime: 62 });
  send(1_000, 'timeupdate', { currentTime: 63 });
  send(1_000, 'timeupdate', { currentTime: 64 });
  expect(meter.getTotals().watchMs).toBe(1_000);
});

it('播放中拖到未缓冲位置，seeked 后的加载等待不计卡顿，恢复推进后照常计量', () => {
  const { meter, send, start } = setup();
  start();
  send(1_000, 'timeupdate', { currentTime: 1.1 });
  send(0, 'seeking', { seeking: true, currentTime: 400 });
  send(0, 'seeked', { seeking: false });
  send(0, 'waiting');
  for (let i = 0; i < 10; i += 1) send(1_000);
  expect(meter.getTotals()).toEqual({
    watchMs: 1_000,
    stallCount: 0,
    stallMs: 0,
    unknownMs: 0,
  });
  send(0, 'playing');
  send(500, 'timeupdate', { currentTime: 400.5 });
  send(1_000, 'timeupdate', { currentTime: 401.5 });
  send(0, 'waiting');
  send(2_000);
  expect(meter.getTotals()).toMatchObject({
    watchMs: 2_000,
    stallCount: 1,
    stallMs: 2_000,
  });
});

it.each([
  { visible: false },
  { online: false },
  { paused: true },
  { resourceWaiting: true },
  { seeking: true },
])('排除状态 %j 取消待确认卡顿，等待期间不累计', (excluded) => {
  const { meter, send, start } = setup();
  start();
  send(0, 'waiting');
  send(500, 'tick', excluded);
  send(10_000, 'waiting');
  expect(meter.getTotals()).toEqual({
    watchMs: 0,
    stallCount: 0,
    stallMs: 0,
    unknownMs: 0,
  });
});

it('隐藏前已确认的卡顿结算到隐藏边界，返回前台不补计隐藏时长', () => {
  const { meter, send, start } = setup();
  start();
  send(0, 'waiting');
  send(1_000);
  send(500, 'tick', { visible: false });
  send(60_000);
  send(0, 'playing', { visible: true });
  send(100, 'timeupdate', { currentTime: 0.2 });
  expect(meter.getTotals()).toMatchObject({ stallMs: 1_500, watchMs: 0 });
});

it('恢复后一秒内再次等待合并，之后的等待另计', () => {
  const { meter, send, start } = setup();
  start();
  send(0, 'waiting');
  send(1_000);
  send(1_000, 'timeupdate', { currentTime: 0.2 });
  send(1_000, 'stalled', { currentTime: 0.3 });
  send(1_000);
  send(1_000, 'timeupdate', { currentTime: 0.4 });
  expect(meter.getTotals()).toMatchObject({
    stallCount: 1,
    stallMs: 4_000,
    watchMs: 1_000,
  });
  send(1_001, 'waiting', { currentTime: 0.5 });
  send(1_000);
  expect(meter.getTotals().stallCount).toBe(2);
});

it('卡顿中结束照常确认结算并封顶三十秒，重复结束保持幂等', () => {
  const { meter, send, start, advance } = setup();
  start();
  send(0, 'waiting');
  advance(60_000);
  meter.finish();
  expect(meter.getTotals()).toMatchObject({ stallCount: 1, stallMs: 30_000 });
  meter.finish();
  send(60_000, 'playing');
  expect(meter.getTotals().stallMs).toBe(30_000);
});

it('增量独立于总量，进行中卡顿分次上报不重复计数', () => {
  const { meter, send, start } = setup();
  start();
  send(1_000, 'waiting');
  send(1_000);
  const first = meter.takeDelta();
  send(1_000);
  expect(meter.takeDelta()).toEqual({
    watchMs: 0,
    stallCount: 0,
    stallMs: 1_000,
    unknownMs: 0,
  });
  expect(meter.takeDelta()).toEqual({
    watchMs: 0,
    stallCount: 0,
    stallMs: 0,
    unknownMs: 0,
  });
  expect(meter.getTotals()).toEqual({
    ...first,
    stallMs: first.stallMs + 1_000,
  });
});

it('异常大 tick 最多累计五秒墙钟', () => {
  const { meter, send, start } = setup();
  start();
  send(60_000, 'timeupdate', { currentTime: 60.1 });
  expect(meter.getTotals().watchMs).toBe(5_000);
});
